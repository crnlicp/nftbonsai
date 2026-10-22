#!/usr/bin/env bash
# Source this file before running mops/icp commands in environments behind
# a TLS-intercepting corporate proxy.
#
# Usage:
#   source scripts/dev-env.sh
#
# Make Node trust the system CA bundle (picks up corporate roots installed there)
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/etc/ssl/certs/ca-certificates.crt}"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-openssl-ca"

echo "[dev-env] NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS"
echo "[dev-env] Using the system OpenSSL trust store; TLS verification stays enabled."
