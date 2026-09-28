FROM node:23-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /kaboard ./cmd/kaboard && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=api /kaboard /kaboard
COPY --from=api --chown=65532:65532 /out/data /data
ENV KABOARD_DATA=/data
VOLUME /data
EXPOSE 4411
ENTRYPOINT ["/kaboard"]
