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

FROM node:20-alpine

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

# Export build args as environment variables
ENV LEADCMS_URL=$LEADCMS_URL
ENV LEADCMS_API_KEY=$LEADCMS_API_KEY
ENV LEADCMS_DEFAULT_LANGUAGE=$LEADCMS_DEFAULT_LANGUAGE

# Support Next.js environment variables for backward compatibility
ENV NEXT_PUBLIC_LEADCMS_URL=$LEADCMS_URL
ENV NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE=$LEADCMS_DEFAULT_LANGUAGE

# Install dependencies
RUN npm ci --verbose

# Copy application code
COPY . .

# Copy nginx configuration for development proxy
COPY preview/nginx.conf /etc/nginx/nginx.conf

# Copy supervisor configuration for multi-service management
COPY preview/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script
RUN echo '#!/bin/sh' > /start.sh && \
    echo '# Fetch initial LeadCMS content if configuration is available' >> /start.sh && \
    echo 'if [ ! -z "$LEADCMS_URL" ] && [ ! -z "$LEADCMS_API_KEY" ]; then' >> /start.sh && \
    echo '  echo "Fetching initial LeadCMS content..."' >> /start.sh && \
    echo '  npx leadcms fetch || echo "Warning: Could not fetch initial content"' >> /start.sh && \
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
