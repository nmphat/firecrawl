FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Install Chromium system dependencies (shared libs needed by any Chromium binary)
RUN npx playwright install-deps chromium

RUN chown -R node:node /usr/src/app

USER node

# Pre-download the CloakBrowser stealth Chromium (~200MB) as the runtime user,
# so its cache is in a home directory that user can read.
RUN node --input-type=module -e "import { launch } from 'cloakbrowser'; const b = await launch({headless:true, args:['--no-sandbox','--disable-gpu']}); await b.close();"

ARG PORT
ENV PORT=${PORT}

EXPOSE ${PORT}

# cloakbrowser is ESM-only, so run the TypeScript directly under tsx instead of
# building to dist/ and running the CommonJS entrypoint.
CMD [ "pnpm", "exec", "tsx", "api.ts" ]
