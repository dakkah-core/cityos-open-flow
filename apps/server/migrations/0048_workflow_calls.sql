CREATE TABLE workflow_calls (
  parent_run_id TEXT NOT NULL,
  parent_flow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  child_run_id TEXT NOT NULL UNIQUE,
  child_flow_id TEXT NOT NULL,
  deadline_at INTEGER,
  PRIMARY KEY (parent_run_id, job_id)
) STRICT;
CREATE INDEX workflow_call_deadline ON workflow_calls(deadline_at) WHERE deadline_at IS NOT NULL;
