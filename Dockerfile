FROM node:16-alpine

# Install additional packages
RUN apk update && \
    apk upgrade && \
    apk add --no-cache git tini bash python3 py3-pip && \
    pip install --no-cache-dir websockify

# Set the working directory
WORKDIR /home/node

# Copy your application code
COPY ./ /home/node

# Change ownership of the application files
RUN chown -R node:node /home/node

# Not sure whether or why this step is necessary
ENV PATH=/home/node/.npm-global/bin:/home/node:$PATH
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global

# Install dependencies and build the project as root
RUN npm install && npm run build
RUN apk del gcc git

# Change to the node user
USER node

EXPOSE 8081

RUN chmod +x /home/node/docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
