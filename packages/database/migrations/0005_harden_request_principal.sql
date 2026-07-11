CREATE OR REPLACE FUNCTION app.has_request_principal()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
BEGIN
  IF session_user = 'english_worker' AND app.current_worker_id() IS NOT NULL THEN
    RETURN app.current_tenant_id() IS NOT NULL;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM tenant_memberships membership
    WHERE membership.tenant_id = app.current_tenant_id()
      AND membership.id = app.current_membership_id()
      AND membership.user_id = app.current_user_id()
      AND membership.status = 'active'
  );
END;
$function$;

REVOKE ALL ON FUNCTION app.has_request_principal() FROM PUBLIC;
ALTER FUNCTION app.has_request_principal() OWNER TO english_assessment_owner;
GRANT EXECUTE ON FUNCTION app.has_request_principal() TO english_app, english_worker;
