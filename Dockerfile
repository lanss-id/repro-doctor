# The sandbox image Repro Doctor runs repair and verification commands in.
#
# It deliberately contains nothing but a Node toolchain: no source, no
# credentials, no Docker client, no oracle. The workspace copy is bind mounted
# at /work at run time, and the hidden oracle is mounted read only at /oracle
# only during verification, after the agent's session is over.
FROM node:22-bookworm-slim

# TypeScript is installed globally so fixture repositories can compile without
# a network install. The version is pinned so builds are reproducible.
ARG TYPESCRIPT_VERSION=5.9.3
RUN npm install --global "typescript@${TYPESCRIPT_VERSION}" \
  && npm cache clean --force

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_CACHE=/tmp/.npm \
    HOME=/tmp

WORKDIR /work

# The CLI always passes --user, --network none, --read-only and resource limits.
# This default is only what you get if someone runs the image by hand.
USER node

CMD ["node", "--version"]
