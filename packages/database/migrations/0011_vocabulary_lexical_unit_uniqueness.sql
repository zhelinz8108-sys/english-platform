CREATE UNIQUE INDEX uq_vocabulary_assessment_items_lexical_unit_version
  ON vocabulary_assessment_items (
    tenant_id,
    language_version,
    lexical_unit_key,
    content_version
  )
  WHERE lexical_unit_key IS NOT NULL;
