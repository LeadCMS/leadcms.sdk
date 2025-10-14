
FROM nginx:alpine

# Copy pre-built static site from local 'out' folder
COPY out /usr/share/nginx/html

# Copy nginx config and runtime env script
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY scripts/inject-runtime-env.sh /app/scripts/inject-runtime-env.sh
RUN chmod -R 755 /usr/share/nginx/html && chmod +x /app/scripts/inject-runtime-env.sh

EXPOSE 80

CMD ["/bin/sh", "-c", "/app/scripts/inject-runtime-env.sh && nginx -g 'daemon off;'"]

