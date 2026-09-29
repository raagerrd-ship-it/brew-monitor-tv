ALTER TABLE public.pi_telemetry_seen DROP CONSTRAINT pi_telemetry_seen_pkey;
ALTER TABLE public.pi_telemetry_seen ADD PRIMARY KEY (controller_id, kind);