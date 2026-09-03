BEGIN;

DROP TRIGGER IF EXISTS compliance_monitor_ledger_entries_v1
  ON public.ledger_entries_v2;

DROP TRIGGER IF EXISTS compliance_events_immutable_v1
  ON public.compliance_events;

DROP FUNCTION IF EXISTS public.evaluate_ledger_compliance_v1();
DROP FUNCTION IF EXISTS public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz);
DROP FUNCTION IF EXISTS public.reject_compliance_event_mutation_v1();

-- Keep evidence tables by default during an emergency rollback. Removing the
-- enforcement trigger restores pre-5.2 money behavior immediately while
-- preserving any compliance evidence already written for investigation.

COMMIT;
