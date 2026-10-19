ALTER TABLE runs ADD COLUMN initiator_actor_id TEXT;
ALTER TABLE runs ADD COLUMN initiator_channel TEXT CHECK (initiator_channel IN ('workbench', 'cli', 'mcp', 'api', 'trigger', 'workflow'));
