FROM node:16.14-alpine as base

WORKDIR /tests

RUN apk --update --no-cache \
    add g++ make python3

FROM base as build

WORKDIR /tests

COPY ./ ./
RUN npm ci
RUN npm run build

CMD ["node", "-v"]
