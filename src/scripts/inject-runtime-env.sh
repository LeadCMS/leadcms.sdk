#!/bin/sh
# This script updates public/__env.js with current NEXT_PUBLIC_ env vars at container startup
set -e

ENV_JS_PATH="/usr/share/nginx/html/__env.js"

if [ ! -f "$ENV_JS_PATH" ]; then
  echo "__env.js not found at $ENV_JS_PATH, skipping runtime env injection."
  exit 0
fi

echo "Updating $ENV_JS_PATH with current NEXT_PUBLIC_ env vars..."

# Find all env vars starting with NEXT_PUBLIC_ and output only defined ones
JS="window.__env = {"
FIRST=1
while IFS='=' read -r KEY VAL; do
  if [[ $KEY == NEXT_PUBLIC_* ]]; then
    # Strip leading/trailing quotes if present
    STRIPPED_VAL=$(printf '%s' "$VAL" | sed 's/^"//;s/"$//')
    # Escape backslashes and double quotes for JS string
    ESCAPED_VAL=$(printf '%s' "$STRIPPED_VAL" | sed 's/\\/\\\\/g; s/"/\\"/g')
    if [ $FIRST -eq 0 ]; then
      JS="$JS,"
    fi
    JS="$JS \"$KEY\": \"$ESCAPED_VAL\""
    FIRST=0
  fi
done < <(env)
JS="$JS};"

echo "$JS" > "$ENV_JS_PATH"
echo "Injected runtime envs into $ENV_JS_PATH."
