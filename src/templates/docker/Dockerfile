# LeadCMS Static Site Production Dockerfile
# This Dockerfile serves pre-built static files using nginx
# Works with any static site generator (Next.js, Astro, Gatsby, Nuxt, etc.)
#
# Usage from project root:
# 1. Build your static site to 'out' or 'dist' directory
# 2. docker build -t my-leadcms-site .
# 3. docker run -p 80:80 my-leadcms-site

FROM nginx:alpine

# Copy pre-built static site from local 'out' folder
# Note: Adjust the source directory based on your static site generator:
# - Next.js: out/
# - Astro: dist/
# - Gatsby: public/
# - Nuxt: dist/
COPY out /usr/share/nginx/html

# Copy nginx configuration and runtime environment injection script
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY scripts/inject-runtime-env.sh /app/scripts/inject-runtime-env.sh

# Set appropriate permissions
RUN chmod -R 755 /usr/share/nginx/html && chmod +x /app/scripts/inject-runtime-env.sh

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --spider -q http://localhost:80 || exit 1

# Start nginx with runtime environment injection
CMD ["/bin/sh", "-c", "/app/scripts/inject-runtime-env.sh && nginx -g 'daemon off;'"]
