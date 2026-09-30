# Serves the fidelity-kit results site. Build context: repository root
FROM --platform=linux/amd64 node:24-slim

RUN npm install -g fidelity-kit@1.1.0
COPY submodules/mtlx-sample-library/materials /data
COPY results/index.md /data/index.md
RUN fidelity-kit process /data && fidelity-kit hash /data

ENV PORT=8080
EXPOSE 8080
CMD ["fidelity-kit", "serve", "/data", "--host", "0.0.0.0", "--port", "8080", "--no-process"]
