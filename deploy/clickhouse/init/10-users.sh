#!/bin/bash
# Task 016 §6 — create least-privilege analytics users on first container init. Runs as part of
# the official image's /docker-entrypoint-initdb.d, connecting as `default` over loopback (which
# harden.xml restricts to localhost). Writer: DDL + INSERT/SELECT on the analytics DB only.
# Reader: SELECT only, strict read-only profile. Passwords come from the container environment.
set -e

clickhouse client -n <<-EOSQL
    CREATE DATABASE IF NOT EXISTS ${CH_DB};

    CREATE USER IF NOT EXISTS ${CH_WRITE_USER} IDENTIFIED BY '${CH_WRITE_PASSWORD}';
    GRANT SELECT, INSERT, ALTER, CREATE TABLE, CREATE DATABASE, DROP TABLE, OPTIMIZE ON ${CH_DB}.* TO ${CH_WRITE_USER};

    CREATE USER IF NOT EXISTS ${CH_READ_USER} IDENTIFIED BY '${CH_READ_PASSWORD}' SETTINGS PROFILE 'readonly_strict';
    GRANT SELECT ON ${CH_DB}.* TO ${CH_READ_USER};
EOSQL

echo "[clickhouse-init] created ${CH_WRITE_USER} (rw) and ${CH_READ_USER} (ro) on ${CH_DB}"
