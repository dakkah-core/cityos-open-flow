CREATE TABLE revisions (
  revision_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  content TEXT NOT NULL
) STRICT;

CREATE TABLE flows (
  flow_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retiring')),
  draft_revision_id TEXT NOT NULL,
  create_idempotency_key TEXT NOT NULL UNIQUE,
  create_request_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deletion_requested_at INTEGER,
  deletion_attempted_at INTEGER
) STRICT;

CREATE INDEX flows_list ON flows (created_at, flow_id);
CREATE INDEX flows_retirement ON flows (status, deletion_attempted_at, deletion_requested_at, flow_id);

CREATE TABLE flow_revisions (
  revision_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  parent_revision_id TEXT,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX flow_revisions_flow ON flow_revisions (flow_id, created_at, revision_id);

CREATE TABLE flow_presentations (
  flow_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  value TEXT NOT NULL CHECK (json_valid(value) AND json_type(value) = 'object'),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE publications (
  interface_json TEXT NOT NULL CHECK (json_valid(interface_json) AND json_type(interface_json) = 'object'),
  publication_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  closure_digest TEXT NOT NULL,
  engine_contract TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'rollback')),
  source_publication_id TEXT,
  model_version INTEGER NOT NULL CHECK (model_version > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (flow_id, idempotency_key)
) STRICT;

CREATE INDEX publications_list ON publications (flow_id, created_at DESC, publication_id DESC);

CREATE TABLE flow_live (
  flow_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  closure_digest TEXT NOT NULL,
  model_version INTEGER NOT NULL CHECK (model_version > 0),
  engine_contract TEXT NOT NULL,
  engine_digest TEXT NOT NULL,
  inputs TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('draft', 'live', 'trigger')),
  publication_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'starting', 'running', 'canceled', 'completed', 'failed', 'indeterminate')),
  result TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  event_bytes INTEGER NOT NULL DEFAULT 0,
  events_truncated INTEGER NOT NULL DEFAULT 0 CHECK (events_truncated IN (0, 1)),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  events_expires_at INTEGER
) STRICT;

CREATE INDEX runs_flow_list ON runs (flow_id, created_at, run_id);
CREATE INDEX runs_events_expiry ON runs (events_expires_at, run_id);

CREATE TABLE trigger_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  trigger_node_id TEXT NOT NULL,
  payload TEXT NOT NULL
) STRICT;

CREATE TABLE webhook_bindings (
  endpoint_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  trigger_node_id TEXT NOT NULL,
  current_publication_id TEXT,
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  trigger_json TEXT CHECK (trigger_json IS NULL OR (json_valid(trigger_json) AND json_type(trigger_json) = 'object')),
  operator_state TEXT NOT NULL DEFAULT 'active' CHECK (operator_state IN ('active', 'paused')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  UNIQUE (flow_id, trigger_node_id)
) STRICT;

CREATE TABLE cron_bindings (
  binding_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  trigger_node_id TEXT NOT NULL,
  current_publication_id TEXT,
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  trigger_json TEXT CHECK (trigger_json IS NULL OR (json_valid(trigger_json) AND json_type(trigger_json) = 'object')),
  schedule_json TEXT CHECK (schedule_json IS NULL OR (json_valid(schedule_json) AND json_type(schedule_json) = 'array')),
  next_at INTEGER,
  operator_state TEXT NOT NULL DEFAULT 'active' CHECK (operator_state IN ('active', 'paused')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  UNIQUE (flow_id, trigger_node_id)
) STRICT;

CREATE TABLE poll_bindings (
  binding_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  trigger_node_id TEXT NOT NULL,
  current_publication_id TEXT,
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  trigger_json TEXT CHECK (trigger_json IS NULL OR (json_valid(trigger_json) AND json_type(trigger_json) = 'object')),
  connection_id TEXT,
  schedule_json TEXT CHECK (schedule_json IS NULL OR (json_valid(schedule_json) AND json_type(schedule_json) = 'array')),
  next_at INTEGER,
  retry_at INTEGER,
  health TEXT NOT NULL CHECK (health IN ('initializing', 'healthy', 'needs_reauth', 'failed')),
  checkpoint_json TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(checkpoint_json)),
  continuation_root_id TEXT,
  continuation_page INTEGER NOT NULL DEFAULT 0 CHECK (continuation_page >= 0),
  active_claim_id TEXT,
  active_lease_token TEXT,
  active_lease_expires_at INTEGER,
  operator_state TEXT NOT NULL DEFAULT 'active' CHECK (operator_state IN ('active', 'paused')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  last_error_code TEXT,
  UNIQUE (flow_id, trigger_node_id)
) STRICT;

CREATE INDEX poll_bindings_wake ON poll_bindings (next_at, retry_at, binding_id);

CREATE TABLE integration_bindings (
  binding_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL UNIQUE,
  flow_id TEXT NOT NULL,
  trigger_node_id TEXT NOT NULL,
  current_publication_id TEXT,
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json) AND json_type(trigger_json) = 'object'),
  connection_id TEXT NOT NULL,
  health TEXT NOT NULL CHECK (health IN ('initializing', 'healthy', 'needs_reauth', 'failed')),
  reconcile_at INTEGER,
  retry_at INTEGER,
  operator_state TEXT NOT NULL DEFAULT 'active' CHECK (operator_state IN ('active', 'paused')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  last_error_code TEXT,
  UNIQUE (flow_id, trigger_node_id)
) STRICT;

CREATE INDEX integration_bindings_wake ON integration_bindings (reconcile_at, retry_at, binding_id);

CREATE TABLE integration_states (
  binding_id TEXT PRIMARY KEY,
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json) AND json_type(trigger_json) = 'object'),
  connection_id TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  subscription_json TEXT NOT NULL CHECK (json_valid(subscription_json) AND json_type(subscription_json) = 'object'),
  reconcile_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX integration_states_wake ON integration_states (reconcile_at, binding_id);

CREATE TABLE poll_claims (
  binding_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  root_occurrence_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 0),
  runtime_version INTEGER NOT NULL CHECK (runtime_version > 0),
  run_id TEXT,
  completed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (binding_id, claim_id)
) STRICT;

CREATE INDEX poll_claims_expiry ON poll_claims (expires_at, binding_id, claim_id);

CREATE TABLE poll_event_dedupe (
  binding_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (binding_id, provider_event_id)
) STRICT;

CREATE INDEX poll_event_dedupe_expiry ON poll_event_dedupe (expires_at, binding_id, provider_event_id);

CREATE TABLE webhook_admissions (run_id TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL, runtime_version INTEGER NOT NULL CHECK (runtime_version > 0), publication_id TEXT NOT NULL) STRICT;
CREATE TABLE cron_admissions (run_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, runtime_version INTEGER NOT NULL CHECK (runtime_version > 0), publication_id TEXT NOT NULL, scheduled_at TEXT NOT NULL) STRICT;
CREATE TABLE poll_admissions (run_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, runtime_version INTEGER NOT NULL CHECK (runtime_version > 0), publication_id TEXT NOT NULL, root_occurrence_id TEXT NOT NULL, page INTEGER NOT NULL CHECK (page >= 0)) STRICT;
CREATE TABLE integration_admissions (run_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, runtime_version INTEGER NOT NULL CHECK (runtime_version > 0), publication_id TEXT NOT NULL) STRICT;

CREATE TABLE trigger_activities (
  activity_id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivery.failed', 'health.failed', 'health.needs_reauth', 'health.recovered', 'health.suspended', 'operator.paused', 'operator.resumed')),
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 512),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX trigger_activities_binding ON trigger_activities (binding_id, created_at DESC, activity_id DESC);
CREATE INDEX trigger_activities_expiry ON trigger_activities (expires_at, activity_id);

CREATE TABLE work (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL UNIQUE) STRICT;

CREATE TABLE events (
  run_id TEXT NOT NULL,
  cursor INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  value TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, cursor)
) STRICT;
