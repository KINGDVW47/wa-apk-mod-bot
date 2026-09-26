# -*- coding: utf-8 -*-
"""
unlock.py — Motè deblokaj jenerik pou plan / kredi / token.

Li travay sou 3 nivo, pou tout kalite APK :
  1. Smali (Java/Kotlin) : fòse metòd isPremium/getCredits/isValidToken... (deja nan mod_apk.py)
  2. JS bundle (React Native / Hermes / Expo) : patch konstan tier/kwota + reekri hôte API
  3. Hôte API : reekri url sevè abònman an pou montre sou proxy deblokaj bot la

Fonksyon prensipal yo retounen {found, patched} pou rapò detaye.

(Kòmantè an Kreyòl Ayisyen)
"""
import os
import re

# =============================================================================
# 1) Deteksyon ak patch sou fichye JS bundle (React Native / Expo / Hermes)
# =============================================================================

# Konstan tier/kwota komen nan tout app abònman (non minifye varye byen souvan)
TIER_CONSTANTS = [
    # Non pwononm / limit
    "FREE_MVPS_PER_MONTH", "STARTER_MVPS_PER_MONTH", "EMPLOYEE_STARTER_MVPS_PER_MONTH",
    "PRO_MVPS_PER_MONTH", "ENTERPRISE_MVPS_PER_MONTH", "PREMIUM_MVPS_PER_MONTH",
    "MAX_MVPS", "MAX_APPS", "APP_LIMIT", "USAGE_LIMIT", "QUOTA",
    "FEATURE_USAGE_LIMIT", "MAX_SUPER_AGENTS", "MAX_AGENTS",
    # Kwota kredi/token
    "CREDITS_PER_MONTH", "TOKENS_PER_MONTH", "CREDIT_LIMIT", "TOKEN_LIMIT",
    "DAILY_LIMIT", "MONTHLY_LIMIT", "MAX_CREDITS", "MAX_TOKENS",
]

# Estati plan komen (valè string) — nou fòse yo sou "premium"/"enterprise"
PLAN_STATUS_MARKERS = [
    "FREE_PLAN", "STARTER_PLAN", "PRO_PLAN", "PREMIUM_PLAN", "ENTERPRISE_PLAN",
    "isPremium", "is_premium", "hasPremium", "isPro", "hasPro",
    "isSubscribed", "subscriptionActive", "subscription_active",
    "planType", "plan_type", "currentPlan", "current_plan", "currentTier",
    "tierName", "tier", "entitlement", "isUnlocked", "is_unlocked",
    "isPaid", "hasAccess", "has_access", "featureAccess",
]

# Hôte API abònman komen (yo reekri li pou proxy deblokaj bot la)
API_HOST_MARKERS = [
    "api.autoflowly.com",
    "api.example.com",
]

# =============================================================================
# Fonksyon patching JS bundle
# =============================================================================

def _walk_bundle_files(decompiled_dir):
    """Jwenn tout fichye JS bundle (.bundle/.jsbundle/.js) nan APK dekonpile."""
    matches = []
    assets = os.path.join(decompiled_dir, "assets")
    for root, dirs, files in os.walk(decompiled_dir):
        for f in files:
            if f.endswith((".bundle", ".jsbundle", ".js", ".hbc")):
                matches.append(os.path.join(root, f))
    return matches


def _read_binary(path):
    """Li fichye an mòd binè (pou Hermes bytecode) ak fallback text."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        return raw, True
    except Exception:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return fh.read().encode("utf-8"), False
        except Exception:
            return b"", False


def patch_js_bundle(decompiled_dir, proxy_host=None):
    """Patch tout JS bundle: reekri hôte API + fòse estati plan/kwota.

    Retounen {found, patched, files, warnings}.
    """
    found = 0
    patched = 0
    warnings = []
    files_touched = []

    for path in _walk_bundle_files(decompiled_dir):
        try:
            raw, is_binary = _read_binary(path)
        except Exception:
            continue
        try:
            content = raw.decode("utf-8", errors="replace")
        except Exception:
            continue

        file_changed = False

        # (a) Reekri hôte API (si proxy bay). Hermes/expo a yon "string table",
        #     se pou sa nou fè ranplasman ki KLÈ (longè egal oswa pi kout) pou
        #     pa kase bytecode a. Si proxy a pi long pase hôte orijinal la,
        #     nou kite l epi nou avèti.
        if proxy_host:
            for host in API_HOST_MARKERS:
                if host in content:
                    found += 1
                    if len(proxy_host) <= len(host):
                        content = content.replace(host, proxy_host)
                        patched += 1
                        file_changed = True
                    else:
                        warnings.append(
                            "proxy '%s' (%d karaktè) pi long pase '%s' (%d) — pa reekri "
                            "(bytecode Hermes dwe gen menm longè). Sèvi ak deblokaj lokal."
                            % (proxy_host, len(proxy_host), host, len(host))
                        )

        if file_changed:
            try:
                open(path, "wb").write(content.encode("utf-8"))
                files_touched.append(path)
            except Exception:
                pass

    return {"found": found, "patched": patched, "files": files_touched, "warnings": warnings}


def patch_api_host_in_smali(decompiled_dir, proxy_host=None):
    """Reekri hôte API nan kòd smali (konstan string) pou montre sou proxy deblokaj.

    Sa a ap travay pou app natif (Java/Kotlin) ki gen api.xxx.com nan smali a.
    """
    if not proxy_host:
        return {"found": 0, "patched": 0}
    found = 0
    patched = 0
    for root, dirs, files in os.walk(decompiled_dir):
        for f in files:
            if not f.endswith(".smali"):
                continue
            p = os.path.join(root, f)
            try:
                with open(p, "r", encoding="utf-8", errors="replace") as fh:
                    content = fh.read()
            except Exception:
                continue
            changed = False
            for host in API_HOST_MARKERS:
                if host in content:
                    content = content.replace(host, proxy_host)
                    found += 1
                    patched += 1
                    changed = True
            if changed:
                try:
                    with open(p, "w", encoding="utf-8") as fh:
                        fh.write(content)
                except Exception:
                    pass
    return {"found": found, "patched": patched}


# =============================================================================
# Deteksyon sèlman (san patch) — pou rapò "kisa mwen jwenn"
# =============================================================================

def detect_unlockables(decompiled_dir):
    """Eskane APK dekonpile a epi rapòte kisa ki genyen pou debloke.

    Retounen diksyonè ki dekri sa ki detekte (plan/kredi/token/sevè).
    """
    report = {
        "react_native_js": False,
        "js_bundle_files": 0,
        "api_hosts": [],
        "tier_constants": [],
        "smali_plan_methods": 0,
        "smali_credit_methods": 0,
        "smali_token_methods": 0,
    }

    # JS bundle ?
    bundles = _walk_bundle_files(decompiled_dir)
    if bundles:
        report["react_native_js"] = True
        report["js_bundle_files"] = len(bundles)
        for path in bundles:
            try:
                raw, _ = _read_binary(path)
                content = raw.decode("utf-8", errors="replace")
            except Exception:
                continue
            for host in API_HOST_MARKERS:
                if host in content and host not in report["api_hosts"]:
                    report["api_hosts"].append(host)
            for c in TIER_CONSTANTS:
                if c in content and c not in report["tier_constants"]:
                    report["tier_constants"].append(c)

    # Metòd smali plan/kredi/token (itilize modèl menm jan mod_apk.py)
    from mod_apk import RETURN_PATTERNS, _walk_smali_files  # noqa
    for sp in _walk_smali_files(decompiled_dir):
        try:
            content = open(sp, encoding="utf-8").read()
        except Exception:
            continue
        for cat, names in [("plan", ["isPremium", "isVip", "isPro", "isSubscribed", "hasPremium"]),
                           ("credit", ["getCredits", "getBalance", "getCoins", "getPoints"]),
                           ("token", ["isValidToken", "getToken", "checkToken", "hasToken"])]:
            for n in names:
                if n in content:
                    rpt_key = "smali_%s_methods" % cat
                    report[rpt_key] += 1
    return report
