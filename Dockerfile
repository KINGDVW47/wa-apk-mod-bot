# ============================================================
# BaliBuddy WA — bot WhatsApp (Baileys/Node) + modding APK (Python/Java)
# ============================================================
FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# ---- Dépandans sistèm ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    python3 \
    python3-pip \
    unzip \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# ---- Android build-tools (aapt/aapt2/zipalign/apksigner) ----
ENV BUILD_TOOLS_DIR=/opt/android-sdk/build-tools/android-14
RUN mkdir -p ${BUILD_TOOLS_DIR} && \
    curl -fL --retry 5 --retry-delay 2 -o /tmp/bt.zip "https://dl.google.com/android/repository/build-tools_r34-linux.zip" && \
    unzip -q /tmp/bt.zip -d /tmp/bt && \
    cp /tmp/bt/android-14/aapt /tmp/bt/android-14/aapt2 /tmp/bt/android-14/zipalign /tmp/bt/android-14/apksigner ${BUILD_TOOLS_DIR}/ && \
    cp -r /tmp/bt/android-14/lib64 ${BUILD_TOOLS_DIR}/ && \
    rm -rf /tmp/bt /tmp/bt.zip

# ---- apktool (pou telechaje yon .jar valab, verifye li) ----
ENV APKTOOL_VERSION=2.10.0
RUN curl -fL --retry 5 --retry-delay 2 -o /tmp/apktool.jar \
        "https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar" && \
    mkdir -p /opt/apktool && \
    mv /tmp/apktool.jar /opt/apktool/apktool.jar && \
    printf '#!/usr/bin/env bash\nexec java -jar /opt/apktool/apktool.jar "$@"\n' > /usr/local/bin/apktool && \
    chmod +x /usr/local/bin/apktool && \
    echo "== Verifye apktool jar ==" && \
    unzip -t /opt/apktool/apktool.jar | tail -1 && \
    test -s /opt/apktool/apktool.jar && echo "apktool OK (<=valab .jar)"

# ---- Wrapper cd pou build-tools (resoud $ORIGIN/../lib64 RUNPATH) ----
RUN for b in zipalign aapt aapt2 apksigner; do \
      printf '#!/usr/bin/env bash\ncd "%s" && exec ./%s "$@"\n' "${BUILD_TOOLS_DIR}" "$b" > /usr/local/bin/$b; \
      chmod +x /usr/local/bin/$b; \
    done

# ---- Keystore pèmanan ----
RUN mkdir -p /keys && keytool -genkeypair -alias modbot -keypass android \
    -storepass android -keystore /keys/release.keystore \
    -dname "CN=APK Mod Bot, OU=Modding, O=ModBot, L=Port-au-Prince, S=Ouest, C=HT" \
    -keyalg RSA -keysize 2048 -validity 10000

# ---- App Node.js ----
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY python ./python
COPY public ./public

# Dossiers volim (sesyon + sortie)
RUN mkdir -p /app/session /app/uploads /app/output

ENV NODE_ENV=production
ENV DASHBOARD_PORT=3000

# Pò dashboard (Railway ap ekspoze PORT)
EXPOSE 3000

CMD ["node", "src/index.js"]
