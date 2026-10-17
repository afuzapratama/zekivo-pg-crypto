#!/bin/sh
set -eu
# Agave 4 requires a concrete gossip bind IP; the container gets its own address.
validator_ip=$(hostname -i | awk '{print $1}')
exec solana-test-validator --bind-address "$validator_ip" "$@"
