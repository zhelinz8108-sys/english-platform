CREATE OR REPLACE FUNCTION app.validate_vocabulary_calibration_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parameter_count integer;
  minimum_band_count integer;
  represented_band_count integer;
BEGIN
  IF NEW.status <> 'active' OR OLD.status = 'active' THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(band_count), 0), coalesce(min(band_count), 0), count(*)
    INTO parameter_count, minimum_band_count, represented_band_count
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
     OR represented_band_count < 14
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
