#!/bin/sh
set -e

echo "🔄 Running database migrations..."
tsx node_modules/knex/bin/cli.js --knexfile src/db/knexfile.ts migrate:latest

echo "🚀 Starting server..."
exec node dist/server.js
