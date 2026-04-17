# Tier T1 — Neo-aligned ProjectDiscovery toolchain + common web tools
# Build: docker build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest .

FROM golang:1.23-bookworm AS gobin
ENV CGO_ENABLED=0
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
RUN go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
RUN go install -v github.com/projectdiscovery/katana/cmd/katana@latest
RUN go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
RUN go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
RUN go install -v github.com/ffuf/ffuf/v2@latest

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl bash git jq python3 python3-pip chromium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=gobin /go/bin/nuclei /usr/local/bin/
COPY --from=gobin /go/bin/httpx /usr/local/bin/
COPY --from=gobin /go/bin/subfinder /usr/local/bin/
COPY --from=gobin /go/bin/katana /usr/local/bin/
COPY --from=gobin /go/bin/dnsx /usr/local/bin/
COPY --from=gobin /go/bin/naabu /usr/local/bin/
COPY --from=gobin /go/bin/ffuf /usr/local/bin/

# sqlmap (optional; large)
RUN pip3 install --no-cache-dir --break-system-packages sqlmap 2>/dev/null || pip3 install --no-cache-dir sqlmap

RUN nuclei -update-templates 2>/dev/null || true

WORKDIR /workspace
ENV PATH=/usr/local/bin:/usr/bin:/bin

CMD ["/bin/bash", "-lc", "nuclei -version && httpx -version && echo ok"]
