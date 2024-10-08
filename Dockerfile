FROM node:16-alpine

# Install additional packages
RUN apk update && \
    apk upgrade && \
    apk add --no-cache git tini bash python3 py3-pip && \
    pip install --no-cache-dir websockify

# Set the working directory
WORKDIR /home/node

# Copy your application code
COPY ./ .

# Change ownership of the application files
RUN chown -R node:node .

# Not sure whether or why this step is necessary
ENV PATH=/home/node/.npm-global/bin:/home/node:$PATH
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global

# Change to the node user
USER node

# Install dependencies and build the project as root
RUN npm run build

EXPOSE 8081

RUN chmod +x ./docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
