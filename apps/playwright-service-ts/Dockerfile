FROM node:18-slim

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

COPY . .

# Install Chromium system dependencies (shared libs needed by any Chromium binary)
RUN npx playwright install-deps chromium

# Pre-download CloakBrowser stealth Chromium binary (~200MB)
RUN node --input-type=module -e "import { launch } from 'cloakbrowser'; const b = await launch({headless:true, args:['--no-sandbox','--disable-gpu']}); await b.close();"

ARG PORT
ENV PORT=${PORT}

EXPOSE ${PORT}

# Use tsx runtime to handle ESM imports (cloakbrowser is ESM-only)
CMD [ "npx", "tsx", "api.ts" ]
