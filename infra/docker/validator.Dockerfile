FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bzip2 libssl3 libudev1 && rm -rf /var/lib/apt/lists/*
ARG AGAVE_VERSION=v4.3.2
ARG AGAVE_SHA256=5c9599d7fa397375df69d58e8d4f550ee45463dd6d1ecad9e5a1f053ce8e0933
RUN curl -fL --retry 3 "https://github.com/anza-xyz/agave/releases/download/${AGAVE_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2" -o /tmp/agave.tar.bz2 \
 && echo "${AGAVE_SHA256}  /tmp/agave.tar.bz2" | sha256sum --check \
 && tar -xjf /tmp/agave.tar.bz2 -C /opt \
 && rm /tmp/agave.tar.bz2
ENV PATH="/opt/solana-release/bin:${PATH}"
WORKDIR /ledger
COPY start-validator.sh /usr/local/bin/start-validator
RUN chmod 755 /usr/local/bin/start-validator
ENTRYPOINT ["/usr/local/bin/start-validator"]
CMD ["--ledger", "/ledger/data", "--rpc-port", "8899", "--faucet-port", "9900", "--quiet"]
