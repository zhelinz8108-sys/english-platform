ALTER TABLE vocabulary_assessment_items
  ADD COLUMN lexical_unit_key varchar(160),
  ADD COLUMN lemma varchar(120),
  ADD COLUMN word_family varchar(120),
  ADD COLUMN sense_key varchar(160),
  ADD COLUMN part_of_speech varchar(24),
  ADD COLUMN corpus_source varchar(120),
  ADD COLUMN corpus_rank integer CHECK (corpus_rank IS NULL OR corpus_rank > 0),
  ADD COLUMN language_version varchar(32) NOT NULL DEFAULT 'zh-CN',
  ADD COLUMN item_format varchar(32) NOT NULL DEFAULT 'receptive-recognition'
    CHECK (item_format IN ('receptive-recognition', 'productive-recognition', 'receptive-recall', 'productive-recall')),
  ADD COLUMN ai_drafted boolean NOT NULL DEFAULT false,
  ADD COLUMN masked_context_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN calibration_eligible boolean NOT NULL DEFAULT false;

CREATE INDEX idx_vocabulary_assessment_items_lexical_unit
  ON vocabulary_assessment_items (tenant_id, lexical_unit_key, language_version, status);

CREATE TABLE vocabulary_assessment_item_reviews (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  decision varchar(16) NOT NULL CHECK (decision IN ('approve', 'revise', 'reject')),
  target_sense_valid boolean NOT NULL,
  single_best_answer boolean NOT NULL,
  distractors_balanced boolean NOT NULL,
  context_nondefining boolean NOT NULL,
  masked_context_leak boolean NOT NULL,
  language_natural boolean NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, item_id, reviewer_membership_id),
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES vocabulary_assessment_items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, reviewer_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_vocabulary_assessment_item_reviews_item
  ON vocabulary_assessment_item_reviews (tenant_id, item_id, decision);

CREATE TABLE vocabulary_assessment_calibrations (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  version varchar(80) NOT NULL,
  model varchar(16) NOT NULL CHECK (model IN ('rasch', '2pl', '3pl')),
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'shadow', 'active', 'retired')),
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  external_validation_size integer NOT NULL DEFAULT 0 CHECK (external_validation_size >= 0),
  fit_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fit_summary) = 'object'),
  acceptance_gates jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(acceptance_gates) = 'object'),
  source_checksum varchar(64) NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, version),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('active', 'retired')) = (activated_at IS NOT NULL)),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_vocabulary_assessment_active_calibration
  ON vocabulary_assessment_calibrations (tenant_id)
  WHERE status = 'active';

CREATE TABLE vocabulary_assessment_item_parameters (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  calibration_id uuid NOT NULL,
  difficulty numeric(10,6) NOT NULL,
  discrimination numeric(10,6) NOT NULL DEFAULT 1 CHECK (discrimination > 0),
  guessing numeric(10,6) NOT NULL DEFAULT 0 CHECK (guessing >= 0 AND guessing < 1),
  standard_error numeric(10,6) NOT NULL CHECK (standard_error >= 0),
  infit numeric(10,6),
  outfit numeric(10,6),
  sample_size integer NOT NULL CHECK (sample_size > 0),
  exposure_count integer NOT NULL DEFAULT 0 CHECK (exposure_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, item_id, calibration_id),
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES vocabulary_assessment_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, calibration_id)
    REFERENCES vocabulary_assessment_calibrations(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_vocabulary_assessment_item_parameters_selection
  ON vocabulary_assessment_item_parameters (tenant_id, calibration_id, difficulty, item_id);

CREATE FUNCTION app.protect_vocabulary_item_parameters()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'exposure_count') = (to_jsonb(OLD) - 'exposure_count') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'vocabulary item parameters are immutable; create a new calibration version'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER protect_vocabulary_item_parameters
  BEFORE UPDATE OR DELETE ON vocabulary_assessment_item_parameters
  FOR EACH ROW EXECUTE FUNCTION app.protect_vocabulary_item_parameters();

CREATE FUNCTION app.protect_vocabulary_calibration_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'retired vocabulary calibrations are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.version IS DISTINCT FROM NEW.version
     OR OLD.model IS DISTINCT FROM NEW.model
     OR OLD.source_checksum IS DISTINCT FROM NEW.source_checksum
     OR OLD.sample_size IS DISTINCT FROM NEW.sample_size
     OR OLD.external_validation_size IS DISTINCT FROM NEW.external_validation_size
     OR (OLD.status <> 'draft' AND (
       OLD.fit_summary IS DISTINCT FROM NEW.fit_summary
       OR OLD.acceptance_gates IS DISTINCT FROM NEW.acceptance_gates
     )) THEN
    RAISE EXCEPTION 'calibration evidence is frozen; create a new calibration version'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'retired') THEN
    RAISE EXCEPTION 'active calibration can only remain active or be retired'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_vocabulary_calibration_history
  BEFORE UPDATE ON vocabulary_assessment_calibrations
  FOR EACH ROW EXECUTE FUNCTION app.protect_vocabulary_calibration_history();

CREATE FUNCTION app.validate_vocabulary_calibration_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parameter_count integer;
  minimum_band_count integer;
BEGIN
  IF NEW.status <> 'active' OR OLD.status = 'active' THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(band_count), 0), coalesce(min(band_count), 0)
    INTO parameter_count, minimum_band_count
  FROM (
    SELECT i.band, count(*) AS band_count
    FROM vocabulary_assessment_item_parameters p
    JOIN vocabulary_assessment_items i
      ON i.tenant_id = p.tenant_id AND i.id = p.item_id
    WHERE p.tenant_id = NEW.tenant_id AND p.calibration_id = NEW.id
    GROUP BY i.band
  ) band_parameters;
  IF NEW.sample_size < 500
     OR NEW.external_validation_size < 200
     OR (NEW.model = '2pl' AND NEW.sample_size < 2000)
     OR (NEW.model = '3pl' AND NEW.sample_size < 5000)
     OR parameter_count < 700
     OR minimum_band_count < 20
     OR coalesce((NEW.fit_summary ->> 'releaseReady')::boolean, false) = false
     OR coalesce((NEW.acceptance_gates ->> 'passed')::boolean, false) = false
     OR coalesce((NEW.acceptance_gates ->> 'monotonic')::boolean, false) = false
     OR coalesce((NEW.acceptance_gates ->> 'intervalCoverage')::numeric, 0) NOT BETWEEN 0.90 AND 0.98
     OR coalesce((NEW.acceptance_gates ->> 'standardMeanAbsoluteError')::numeric, 999999) > 800
     OR coalesce((NEW.acceptance_gates ->> 'externalCorrelation')::numeric, 0) < 0.75
     OR coalesce((NEW.acceptance_gates ->> 'retestCorrelation')::numeric, 0) < 0.85
     OR coalesce((NEW.acceptance_gates ->> 'standardWithin60')::numeric, 0) < 0.90
     OR coalesce((NEW.acceptance_gates ->> 'itemFitReviewComplete')::boolean, false) = false
     OR coalesce((NEW.acceptance_gates ->> 'difPassed')::boolean, false) = false THEN
    RAISE EXCEPTION 'vocabulary calibration has not passed the formal release gates'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_vocabulary_calibration_activation
  BEFORE UPDATE ON vocabulary_assessment_calibrations
  FOR EACH ROW EXECUTE FUNCTION app.validate_vocabulary_calibration_activation();

CREATE TABLE vocabulary_assessment_forms (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  form_key varchar(120) NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  mode varchar(16) NOT NULL CHECK (mode IN ('quick', 'standard', 'calibration')),
  purpose varchar(16) NOT NULL CHECK (purpose IN ('screening', 'parallel', 'pilot', 'anchor')),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  language_version varchar(32) NOT NULL DEFAULT 'zh-CN',
  content_version varchar(80) NOT NULL,
  item_count integer NOT NULL CHECK (item_count > 0),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, form_key, version),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE vocabulary_assessment_form_items (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  form_id uuid NOT NULL,
  item_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  is_anchor boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, form_id, position),
  UNIQUE (tenant_id, form_id, item_id),
  FOREIGN KEY (tenant_id, form_id)
    REFERENCES vocabulary_assessment_forms(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES vocabulary_assessment_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE vocabulary_assessment_calibration_exports (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  calibration_version varchar(80) NOT NULL,
  content_version varchar(80) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'ready', 'failed', 'retired')),
  subject_token_version varchar(40) NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  source_checksum varchar(64),
  storage_key varchar(512),
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES tenant_memberships(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'ready') = (completed_at IS NOT NULL AND source_checksum IS NOT NULL AND storage_key IS NOT NULL))
);

CREATE TABLE vocabulary_assessment_calibration_export_rows (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  export_id uuid NOT NULL,
  subject_token varchar(64) NOT NULL,
  session_token varchar(64) NOT NULL,
  item_id uuid NOT NULL,
  response_category varchar(16) NOT NULL CHECK (response_category IN ('correct', 'wrong', 'unknown')),
  response_time_ms integer NOT NULL CHECK (response_time_ms BETWEEN 0 AND 120000),
  item_position integer NOT NULL CHECK (item_position > 0),
  mode varchar(16) NOT NULL CHECK (mode IN ('quick', 'standard', 'calibration')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, export_id)
    REFERENCES vocabulary_assessment_calibration_exports(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id)
    REFERENCES vocabulary_assessment_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_vocabulary_assessment_calibration_export_rows
  ON vocabulary_assessment_calibration_export_rows (tenant_id, export_id, subject_token, item_position);

ALTER TABLE vocabulary_assessment_sessions
  DROP CONSTRAINT vocabulary_assessment_sessions_mode_check,
  ADD CONSTRAINT vocabulary_assessment_sessions_mode_check
    CHECK (mode IN ('quick', 'standard', 'calibration')),
  DROP CONSTRAINT vocabulary_assessment_sessions_stage_check,
  ADD CONSTRAINT vocabulary_assessment_sessions_stage_check
    CHECK (stage IN ('routing', 'precision', 'calibration')),
  ADD COLUMN scoring_mode varchar(16) NOT NULL DEFAULT 'beta'
    CHECK (scoring_mode IN ('beta', 'shadow', 'calibrated')),
  ADD COLUMN form_id uuid,
  ADD COLUMN focus_loss_count integer NOT NULL DEFAULT 0 CHECK (focus_loss_count >= 0),
  ADD FOREIGN KEY (tenant_id, form_id)
    REFERENCES vocabulary_assessment_forms(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE vocabulary_assessment_deliveries
  DROP CONSTRAINT vocabulary_assessment_deliveries_stage_check,
  ADD CONSTRAINT vocabulary_assessment_deliveries_stage_check
    CHECK (stage IN ('routing', 'precision', 'calibration'));

ALTER TABLE vocabulary_assessment_results
  ADD COLUMN score_status varchar(16) NOT NULL DEFAULT 'beta'
    CHECK (score_status IN ('beta', 'shadow', 'calibrated')),
  ADD COLUMN scale varchar(40) NOT NULL DEFAULT 'word-family-1k-14k',
  ADD COLUMN theta numeric(10,6),
  ADD COLUMN standard_error numeric(10,6) CHECK (standard_error IS NULL OR standard_error >= 0),
  ADD COLUMN display_precision integer NOT NULL DEFAULT 500
    CHECK (display_precision IN (100, 500, 1000)),
  ADD COLUMN ability_band varchar(32) NOT NULL DEFAULT 'foundation',
  ADD COLUMN quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(quality_flags) = 'array');

ALTER TABLE vocabulary_assessment_item_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_item_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibrations FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_item_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_item_parameters FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_form_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_form_items FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibration_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibration_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibration_export_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_assessment_calibration_export_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vocabulary_assessment_item_reviews
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_calibrations
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_item_parameters
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_forms
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_form_items
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_calibration_exports
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());
CREATE POLICY tenant_isolation ON vocabulary_assessment_calibration_export_rows
  USING (tenant_id = app.current_tenant_id() AND app.has_request_principal())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_request_principal());

GRANT SELECT, INSERT, UPDATE ON vocabulary_assessment_item_reviews TO english_app, english_worker;
GRANT SELECT ON vocabulary_assessment_calibrations, vocabulary_assessment_item_parameters,
  vocabulary_assessment_forms, vocabulary_assessment_form_items TO english_app;
GRANT UPDATE (exposure_count) ON vocabulary_assessment_item_parameters TO english_app;
GRANT SELECT, INSERT, UPDATE ON vocabulary_assessment_calibrations,
  vocabulary_assessment_item_parameters, vocabulary_assessment_forms,
  vocabulary_assessment_form_items TO english_worker;
GRANT SELECT, INSERT, UPDATE ON vocabulary_assessment_calibration_exports TO english_worker;
GRANT SELECT, INSERT ON vocabulary_assessment_calibration_export_rows TO english_worker;
