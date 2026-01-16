FROM node:24-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Same as in the .env
EXPOSE 3013

CMD [ "node", "server.js" ]