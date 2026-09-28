.PHONY: dev api web web-dev build up down seed dist

dev: dist
	@$(MAKE) -j2 api web-dev

api: dist
	go run ./cmd/kaboard

web-dev:
	cd web && npm run dev

web:
	cd web && npm ci && npm run build

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/kaboard ./cmd/kaboard

up:
	docker compose up -d --build

down:
	docker compose down

seed:
	go run ./cmd/seed

dist:
	@mkdir -p web/dist && touch web/dist/.gitkeep
