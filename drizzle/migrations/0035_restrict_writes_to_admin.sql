DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin','user'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

INSERT INTO public.user_roles (user_id, role) SELECT id, 'admin' FROM auth.users ON CONFLICT DO NOTHING;

DO $$
DECLARE r record; adm text := 'public.has_role(auth.uid(), ''admin''::public.app_role)';
BEGIN
  FOR r IN SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname='public' AND NOT ('service_role' = ANY(roles))
      AND (qual IN ('true','(auth.uid() IS NOT NULL)') OR with_check IN ('true','(auth.uid() IS NOT NULL)'))
      AND (cmd <> 'SELECT' OR NOT ('public' = ANY(roles) OR 'anon' = ANY(roles)))
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
    IF r.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.policyname, r.tablename, adm);
    ELSIF r.cmd IN ('SELECT','DELETE') THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, adm);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.policyname, r.tablename, adm, adm);
    END IF;
  END LOOP;
END $$;

ALTER POLICY "Authenticated users can upload brew labels" ON storage.objects TO authenticated
  WITH CHECK (bucket_id = 'brew-labels' AND public.has_role(auth.uid(), 'admin'));
ALTER POLICY "Authenticated users can update brew labels" ON storage.objects TO authenticated
  USING (bucket_id = 'brew-labels' AND public.has_role(auth.uid(), 'admin'));
ALTER POLICY "Authenticated users can delete brew labels" ON storage.objects TO authenticated
  USING (bucket_id = 'brew-labels' AND public.has_role(auth.uid(), 'admin'));