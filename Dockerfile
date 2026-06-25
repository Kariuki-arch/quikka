# Stage 1: Runtime
FROM nginx:alpine

# Remove default Nginx site configuration
RUN rm /etc/nginx/conf.d/default.conf

# Add our custom Nginx config template
COPY default.conf.template /etc/nginx/conf.d/

# Copy the simple raw HTML interfaces
COPY *.html /usr/share/nginx/html/

# Copy static assets
COPY assets/ /usr/share/nginx/html/assets/

# Expose Web Port
EXPOSE 4321

CMD envsubst '${BACKEND_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
