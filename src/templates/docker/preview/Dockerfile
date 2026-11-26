# LeadCMS Live Preview Dockerfile
# Multi-service container for development/preview with live updates
# Includes nginx reverse proxy, development server, and LeadCMS SSE watcher
# Works with any static site generator that supports live preview
#
# Requirements for your project:
# - npm run livepreview: Start development server on port 3000
# - LeadCMS SDK scripts available
#
# Usage from project root:
# docker build -f preview/Dockerfile -t my-leadcms-site-preview .
# docker run -p 80:80 -e LEADCMS_URL=... -e LEADCMS_API_KEY=... my-leadcms-site-preview

FROM node:24-alpine

# Install nginx and supervisor for multi-service management
RUN apk add --no-cache nginx supervisor wget

# Create required directories
RUN mkdir -p /var/log/supervisor /run/nginx

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Build arguments for LeadCMS configuration
ARG LEADCMS_URL
ARG LEADCMS_API_KEY
ARG LEADCMS_DEFAULT_LANGUAGE=en
# Multi-site projects: which site this preview serves (see `leadcms site list`).
# Leave empty for single-site projects and for the default site.
ARG LEADCMS_SITE

# Export build args as environment variables
ENV LEADCMS_URL=$LEADCMS_URL
ENV LEADCMS_API_KEY=$LEADCMS_API_KEY
ENV LEADCMS_DEFAULT_LANGUAGE=$LEADCMS_DEFAULT_LANGUAGE
ENV LEADCMS_SITE=$LEADCMS_SITE

# Support Next.js environment variables for backward compatibility
ENV NEXT_PUBLIC_LEADCMS_URL=$LEADCMS_URL
ENV NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE=$LEADCMS_DEFAULT_LANGUAGE

# Install dependencies
RUN npm ci --verbose

# Copy application code
COPY . .

# Copy nginx configuration for development proxy
COPY preview/nginx.conf /etc/nginx/nginx.conf

# Install LeadCMS redirect maps for the site this image serves (LEADCMS_SITE).
# They are generated here from the copied redirects.yaml rather than copied from
# the build context, where redirects/ may hold another site's or a stale run's maps.
# Generating needs only local files. A failure here fails the build.
# touch creates empty fallbacks so nginx starts even if a map type has no entries.
RUN npx leadcms generate-redirects-map --output /etc/nginx && \
    touch /etc/nginx/301.map /etc/nginx/302.map

# Copy supervisor configuration for multi-service management
COPY preview/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script. It runs before supervisord starts nginx, so maps
# regenerated from the freshly pulled redirects are loaded without a reload.
RUN echo '#!/bin/sh' > /start.sh && \
    echo '# Pull initial LeadCMS content if configuration is available' >> /start.sh && \
    echo 'if [ ! -z "$LEADCMS_URL" ] && [ ! -z "$LEADCMS_API_KEY" ]; then' >> /start.sh && \
    echo '  echo "Pulling initial LeadCMS content..."' >> /start.sh && \
    echo '  npx leadcms pull || echo "Warning: Could not pull initial content"' >> /start.sh && \
    echo '  npx leadcms generate-redirects-map --output /etc/nginx || echo "Warning: Could not regenerate redirect maps"' >> /start.sh && \
    echo '  touch /etc/nginx/301.map /etc/nginx/302.map' >> /start.sh && \
    echo 'fi' >> /start.sh && \
    echo '' >> /start.sh && \
    echo '# Start supervisor to manage all services' >> /start.sh && \
    echo 'exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf' >> /start.sh

RUN chmod +x /start.sh

# Expose port 80 (nginx will proxy to development server on port 3000)
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --spider -q http://localhost:80 || exit 1

# Start all services via supervisor
CMD ["/start.sh"]
