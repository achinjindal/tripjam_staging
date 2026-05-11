-- Admin flag on profiles (must come before policy that references it)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- LLM usage tracking
CREATE TABLE IF NOT EXISTS llm_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id uuid REFERENCES trips(id),
  function_name text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON llm_usage FOR ALL USING (true);
CREATE POLICY "Admins can read llm_usage" ON llm_usage FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
