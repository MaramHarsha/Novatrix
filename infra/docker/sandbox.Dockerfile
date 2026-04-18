# Novatrix Tier-1+ sandbox — ProjectDiscovery stack + common web/network tooling
# Build: docker build -f infra/docker/sandbox.Dockerfile -t novatrix-sandbox:latest .
#
# For 400+ preinstalled tools use Exegol instead: nwodtuhs/exegol:web-3.1.6 (see docs/EXEGOL.md).

FROM golang:1.23-bookworm AS gobin
ENV CGO_ENABLED=0
# --- ProjectDiscovery ---
RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
RUN go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
RUN go install -v github.com/projectdiscovery/katana/cmd/katana@latest
RUN go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
RUN go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
RUN go install -v github.com/projectdiscovery/uncover/cmd/uncover@latest
RUN go install -v github.com/projectdiscovery/tlsx/cmd/tlsx@latest
RUN go install -v github.com/projectdiscovery/chaos-client/cmd/chaos@latest
# --- Other popular CLI (Go) ---
RUN go install -v github.com/ffuf/ffuf/v2@latest
RUN go install -v github.com/OJ/gobuster/v3@latest
RUN go install -v github.com/owasp-amass/amass/v4/cmd/amass@latest
RUN go install -v github.com/lc/gau/v2/cmd/gau@latest
RUN go install -v github.com/tomnomnom/waybackurls@latest
RUN go install -v github.com/tomnomnom/assetfinder@latest
RUN go install -v github.com/tomnomnom/httprobe@latest
RUN go install -v github.com/tomnomnom/anew@latest

FROM debian:bookworm-slim

# Core tooling first — masscan/nikto are installed in a follow-up RUN because some
# Debian mirrors / builder arches occasionally omit a package name (fails whole install if one misses).
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl bash git jq python3 python3-pip chromium \
    nmap \
    dirb \
    hydra \
    wfuzz \
    sslscan \
    whatweb \
    whois \
    openssl \
    socat \
    netcat-openbsd \
    smbclient \
    dnsutils \
    iputils-ping \
    traceroute \
    libpcap0.8 \
    zip unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Optional scanners — apt may omit one name on some mirrors/arches; image still builds.
RUN apt-get update \
  && (DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends masscan nikto || true) \
  && rm -rf /var/lib/apt/lists/*

# naabu needs libpcap at runtime for some scan modes

COPY --from=gobin /go/bin/nuclei /usr/local/bin/
COPY --from=gobin /go/bin/httpx /usr/local/bin/
COPY --from=gobin /go/bin/subfinder /usr/local/bin/
COPY --from=gobin /go/bin/katana /usr/local/bin/
COPY --from=gobin /go/bin/dnsx /usr/local/bin/
COPY --from=gobin /go/bin/naabu /usr/local/bin/
COPY --from=gobin /go/bin/uncover /usr/local/bin/
COPY --from=gobin /go/bin/tlsx /usr/local/bin/
COPY --from=gobin /go/bin/chaos /usr/local/bin/
COPY --from=gobin /go/bin/ffuf /usr/local/bin/
COPY --from=gobin /go/bin/gobuster /usr/local/bin/
COPY --from=gobin /go/bin/amass /usr/local/bin/
COPY --from=gobin /go/bin/gau /usr/local/bin/
COPY --from=gobin /go/bin/waybackurls /usr/local/bin/
COPY --from=gobin /go/bin/assetfinder /usr/local/bin/
COPY --from=gobin /go/bin/httprobe /usr/local/bin/
COPY --from=gobin /go/bin/anew /usr/local/bin/

# RustScan — official Linux build is amd64-only upstream (bee-san/RustScan)
ARG RUSTSCAN_VERSION=2.3.0
RUN set -eux; \
  ARCH="$(dpkg --print-architecture)"; \
  if [ "$ARCH" = "amd64" ]; then \
    curl -fsSL "https://github.com/bee-san/RustScan/releases/download/${RUSTSCAN_VERSION}/rustscan-${RUSTSCAN_VERSION}-x86_64-linux.tar.xz" -o /tmp/rs.txz; \
    mkdir -p /tmp/rsex; \
    tar -xJf /tmp/rs.txz -C /tmp/rsex; \
    RS="$(find /tmp/rsex -name rustscan -type f | head -1)"; \
    if [ -n "$RS" ]; then mv "$RS" /usr/local/bin/rustscan && chmod +x /usr/local/bin/rustscan; fi; \
    rm -rf /tmp/rsex /tmp/rs.txz; \
  else \
    echo "RustScan: no official binary for linux-${ARCH} — skipped (use nmap/naabu/masscan)."; \
  fi

# Feroxbuster — tar.gz on amd64, zip on arm64
ARG FEROX_VERSION=2.11.0
RUN set -eux; \
  ARCH="$(dpkg --print-architecture)"; \
  if [ "$ARCH" = "amd64" ]; then \
    curl -fsSL "https://github.com/epi052/feroxbuster/releases/download/v${FEROX_VERSION}/x86_64-linux-feroxbuster.tar.gz" -o /tmp/fx.tgz; \
    tar -xzf /tmp/fx.tgz -C /usr/local/bin feroxbuster; \
  elif [ "$ARCH" = "arm64" ]; then \
    curl -fsSL "https://github.com/epi052/feroxbuster/releases/download/v${FEROX_VERSION}/aarch64-linux-feroxbuster.zip" -o /tmp/fx.zip; \
    mkdir -p /tmp/fxb; \
    unzip -o /tmp/fx.zip -d /tmp/fxb; \
    FXB="$(find /tmp/fxb -name feroxbuster -type f | head -1)"; \
    if [ -n "$FXB" ]; then mv "$FXB" /usr/local/bin/feroxbuster; fi; \
    rm -rf /tmp/fxb /tmp/fx.zip; \
  else \
    echo "feroxbuster: unsupported arch $ARCH"; \
  fi; \
  if [ -f /usr/local/bin/feroxbuster ]; then chmod +x /usr/local/bin/feroxbuster; fi

# sqlmap + python helpers (best-effort for optional packages)
RUN pip3 install --no-cache-dir --break-system-packages sqlmap \
  && (pip3 install --no-cache-dir --break-system-packages arjun dirsearch commix || true)

RUN nuclei -update-templates 2>/dev/null || true

WORKDIR /workspace
ENV PATH=/usr/local/bin:/usr/bin:/bin

# Smoke test — ferox/rustscan may be missing on exotic arch without failing build
CMD ["/bin/bash", "-lc", "nuclei -version && httpx -version && echo ok"]
