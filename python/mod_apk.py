# -*- coding: utf-8 -*-
"""
mod_apk.py — Script Python endepandan pou modifikasyon APK (bot WhatsApp).

Li fè:
  1. dekonpile (apktool d)
  2. chanje non app (android:label)
  3. enjekte Toast nan onCreate() launcher
  4. patch opsyonèl: plan, credit, token, lvl, ads, root, signature
  5. rekonstwi (apktool b)
  6. zipalign
  7. apksigner (siyen)

Itilizasyon:
  python3 mod_apk.py <apk_entree> <out_dir> <uid> [--patch=plan] [--patch=credit] ...

Lè siksè li ekri sou dènye liy: OK:<chemen_apk_final>
(Kòmantè an Kreyòl Ayisyen)
"""
import os
import re
import sys
import shutil
import subprocess
import tempfile

# =============================================================================
# Konfigirasyon
# =============================================================================
APKTOOL = "apktool"
ZIPALIGN = "zipalign"
APKSIGNER = "apksigner"

KEYSTORE_PATH = os.environ.get("KEYSTORE_PATH", "/keys/release.keystore")
KEYSTORE_ALIAS = os.environ.get("KEYSTORE_ALIAS", "modbot")
KEYSTORE_PASS = os.environ.get("KEYSTORE_PASS", "android")


# =============================================================================
# Itilite
# =============================================================================
def run_cmd(cmd, cwd=None, timeout=900):
    """Egzekite yon kòmand san deadlock (ekri nan fichye tanporè)."""
    out_f = tempfile.TemporaryFile()
    err_f = tempfile.TemporaryFile()
    try:
        proc = subprocess.run(cmd, cwd=cwd, stdout=out_f, stderr=err_f, timeout=timeout)
        out_f.seek(0); err_f.seek(0)
        return proc.returncode, out_f.read().decode("utf-8", "replace"), err_f.read().decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return -99, "", "Kòmand bloke depase %ds" % timeout
    finally:
        out_f.close(); err_f.close()


def _xml_escape(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&apos;"))


def _str_to_smali(s):
    out = []
    for ch in s:
        if ch == '"': out.append('\\"')
        elif ch == "\\": out.append("\\\\")
        elif ch == "\n": out.append("\\n")
        elif ord(ch) < 32 or ord(ch) > 126: out.append("\\u%04x" % ord(ch))
        else: out.append(ch)
    return '"' + "".join(out) + '"'


def _walk_smali_files(decompiled_dir):
    """Itilize tout fichye .smali (nan tout smali*/ klas)."""
    for root, dirs, files in os.walk(decompiled_dir):
        for f in files:
            if f.endswith(".smali"):
                yield os.path.join(root, f)


def find_launcher_class(decompiled_dir):
    manifest = os.path.join(decompiled_dir, "AndroidManifest.xml")
    if not os.path.exists(manifest):
        return None
    content = open(manifest, encoding="utf-8").read()
    blocks = re.findall(r"(<activity\b[^>]*>)(.*?)</activity>", content, re.DOTALL)
    for open_tag, body in blocks:
        if "android.intent.action.MAIN" in body and "android.intent.category.LAUNCHER" in body:
            m = re.search(r'android:name="([^"]+)"', open_tag)
            if m: return m.group(1)
    for open_tag, body in blocks:
        if "android.intent.action.MAIN" in body:
            m = re.search(r'android:name="([^"]+)"', open_tag)
            if m: return m.group(1)
    return None


def class_to_smali(decompiled_dir, cls):
    cls = cls.lstrip(".").rstrip(";")
    if cls.startswith("L"): cls = cls[1:]
    rel = cls.replace(".", "/") + ".smali"
    for base in ("smali", "smali_classes2", "smali_classes3", "smali_classes4", "smali_classes5"):
        p = os.path.join(decompiled_dir, base, rel)
        if os.path.exists(p): return p
    for root, _, files in os.walk(decompiled_dir):
        if os.path.basename(root).startswith("smali"):
            c = os.path.join(root, rel)
            if os.path.exists(c): return c
    return None


# =============================================================================
# Operasyon debaz
# =============================================================================
def change_app_name(decompiled_dir, new_name):
    manifest = os.path.join(decompiled_dir, "AndroidManifest.xml")
    strings = os.path.join(decompiled_dir, "res", "values", "strings.xml")
    content = open(manifest, encoding="utf-8").read()
    m = re.search(r'android:label="([^"]+)"', content)
    if m:
        label = m.group(1)
        if label.startswith("@string/"):
            key = label[len("@string/"):]
            if os.path.exists(strings):
                s = open(strings, encoding="utf-8").read()
                pat = re.compile(r'(<string name="' + re.escape(key) + r'"[^>]*>)(.*?)(</string>)', re.DOTALL)
                s2, n = pat.subn(lambda mm: mm.group(1) + _xml_escape(new_name) + mm.group(3), s, count=1)
                if n:
                    open(strings, "w", encoding="utf-8").write(s2)
                    return "ok-strings"
        content = content.replace('android:label="%s"' % label, 'android:label="%s"' % _xml_escape(new_name))
        open(manifest, "w", encoding="utf-8").write(content)
        return "ok-manifest"
    else:
        open(manifest, "w", encoding="utf-8").write(
            re.sub(r"<application\b", '<application android:label="%s"' % _xml_escape(new_name), content, count=1))
        return "ok-added"
    return "none"


def inject_toast(decompiled_dir, msg):
    launcher = find_launcher_class(decompiled_dir)
    if not launcher:
        return "launcher-not-found"
    sp = class_to_smali(decompiled_dir, launcher)
    if not sp:
        return "smali-not-found"
    content = open(sp, encoding="utf-8").read()
    m = re.search(r"\.method[^\n]*\bonCreate\b\(Landroid/os/Bundle;\)V\b", content)
    if not m:
        return "onCreate-not-found"
    start = m.start()
    next_m = content.find(".method", start + 1)
    end = next_m if next_m != -1 else len(content)
    body = content[start:end]
    lm = re.search(r"\.locals\s+(\d+)", body)
    if lm and int(lm.group(1)) < 2:
        nb = re.sub(r"\.locals\s+\d+", ".locals 2", body, count=1)
        content = content[:start] + nb + content[end:]
        end = start + len(nb)
        body = nb
    si = body.find("invoke-super")
    if si == -1:
        return "no-invoke-super"
    le = body.find("\n", si)
    if le == -1: le = len(body)
    pos = start + le + 1
    inj = (
        "\n    # --- BaliBuddy WA Toast ---\n"
        "    const-string v0, " + _str_to_smali(msg) + "\n"
        "    const/4 v1, 0x1\n"
        "    invoke-static {p0, v0, v1}, Landroid/widget/Toast;->makeText"
        "(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;\n"
        "    move-result-object v0\n"
        "    invoke-virtual {v0}, Landroid/widget/Toast;->show()V\n")
    content = content[:pos] + inj + content[pos:]
    open(sp, "w", encoding="utf-8").write(content)
    return "ok"


def ensure_keystore():
    if os.path.exists(KEYSTORE_PATH):
        return True
    d = os.path.dirname(KEYSTORE_PATH)
    if d: os.makedirs(d, exist_ok=True)
    cmd = ["keytool", "-genkeypair", "-alias", KEYSTORE_ALIAS, "-keypass", KEYSTORE_PASS,
           "-storepass", KEYSTORE_PASS, "-keystore", KEYSTORE_PATH,
           "-dname", "CN=APK Mod Bot, OU=Modding, O=ModBot, L=Port-au-Prince, S=Ouest, C=HT",
           "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000"]
    code, _, err = run_cmd(cmd, timeout=120)
    return code == 0


# =============================================================================
# Motè patch (smali)
# =============================================================================
# Yon "prensip patching" = (non, regex_non_retou, kò nouvo).
# Nou jwenn yon metòd ki matche "non" + "deskriptè retou", epi nou ranplase kò li
# pou retounen yon valè "fòse" (true/false/konstan). Sa global pou tout APK.

RETURN_PATTERNS = {
    "plan": {
        "names": [
            "isPremium", "ispremium", "hasPremium", "isVip", "isvip", "hasVip",
            "isPro", "ispro", "hasPro", "isSubscribed", "isSubscribe", "isMember",
            "hasActiveSubscription", "checkSubscription", "isGold", "isSilver",
            "getPlan", "isPlatinum", "hasPlan", "premiumEnabled",
        ],
        "returns_true": True,  # fòse retounen TRUE (gen plan/vip/premium)
    },
    "credit": {
        "names": [
            "getCredits", "getcredits", "getBalance", "getbalance", "getCoins",
            "getcoins", "getPoints", "getpoints", "getDiamonds", "getGems",
            "getMoney", "getCurrency", "getCash", "getCoinBalance", "myCredits",
        ],
        "value": 999999,  # fòse retounen gwo valè (retou ent sèlman)
    },
    "token": {
        "names": [
            "getToken", "gettokens", "isValidToken", "checkToken", "hasToken",
            "tokenValid", "getAccessToken", "isTokenValid", "checkApiToken",
        ],
        "returns_true": True,  # token valab / prezan
    },
    "root": {
        "names": [
            "isRooted", "isrooted", "checkRoot", "isDeviceRooted", "detectRoot",
            "isRootAvailable", "isRoot", "rootCheck",
        ],
        "returns_false": True,  # fòse retounen FO (pa gen root → pa bloke)
    },
    "signature": {
        "names": [
            "checkSignature", "isSignatureValid", "verifySignature", "isSignature",
            "checkSign", "isSigned", "verifySign", "isAppVerified",
        ],
        "returns_true": True,  # siyati valab
    },
}

# LVL — Lisans Google (com.android.vending.licensing.LicenseChecker)
LVL_CHECKER_MARKER = "com/android/vending/licensing/LicenseChecker"
LVL_ALLOWED = "com/android/vending/licensing/LicenseCheckerCallback;->ALLOWED"

# Ads — Sèvi patèrn komen SDK reklam
ADS_MARKERS = [
    "com/google/android/gms/ads", "com/applovin", "com/unity3d/ads",
    "com/ironsource", "com/vungle", "com/facebook/ads", "com/startapp",
    "com/chartboost", "com/adcolony", "com/mintegral",
]


def _parse_methods(content):
    """Retounen lis (start, end, header) pou chak .method nan yon fichye smali."""
    res = []
    for m in re.finditer(r"\.method\b", content):
        # jwenn fen header (liy ki kòmanse ak '.end method' se fen kò, pa isit)
        nl = content.find("\n", m.start())
        header = content[m.start():nl if nl != -1 else m.start()+1]
        res.append((m.start(), header))
    # konstwi fen chak metòd
    methods = []
    for i, (start, header) in enumerate(res):
        if i + 1 < len(res):
            end = res[i + 1][0]
        else:
            end = len(content)
        methods.append((start, end, header))
    return methods


def _force_return_true(body):
    """Retounen yon nouvo kò metòd ki retounen TRUE (boolean)."""
    regs = max(1, len(re.findall(r"\bp\d+", body)) )
    return body, None


def _patch_return(decompiled_dir, names, mode):
    """Fòse tout metòd ki matche 'names' pou retounen yon valè fiks.

    mode ∈ {True, False, int}
    Retounen diksyonè {found, patched} pou rapò detaye.
    """
    found = 0
    patched = 0
    compiled = re.compile(r"\.method\b[^\n]*\b(" + "|".join(re.escape(n) for n in names) + r")\s*\(")
    for sp in _walk_smali_files(decompiled_dir):
        try:
            content = open(sp, encoding="utf-8").read()
        except Exception:
            continue
        # kolekte tout korespondans (soti nan fen pou endis yo rete valab)
        matches = []
        for m in compiled.finditer(content):
            end_m = content.find(".end method", m.end())
            if end_m == -1:
                continue
            line_end = content.find("\n", m.start())
            header = content[m.start():line_end if line_end != -1 else m.end()]
            mm = re.search(r"\)([^\s;]+)", header)
            rtype = mm.group(1) if mm else None
            # Detèmine si rtype a matche 'mode'
            ok = False
            if mode is True and rtype == "Z":
                ok = True
            elif mode is False and rtype == "Z":
                ok = True
            elif (mode is not True and mode is not False) and rtype == "I":
                ok = True
            if not ok:
                continue
            found += 1
            matches.append((m.start(), end_m, m.end(), mode))
        # Aplike patch yo (soti nan dènye → premye pou endis pa deplase)
        matches.sort(key=lambda x: -x[0])
        for start, end_m, m_end, mode in matches:
            line_end = content.find("\n", start)
            # bati nouvo kò
            if mode is True:
                body = "\n    const/4 v0, 0x1\n    return v0\n"
            elif mode is False:
                body = "\n    const/4 v0, 0x0\n    return v0\n"
            else:
                val = int(mode)
                body = "\n    const v0, 0x%x\n    return v0\n" % val
            content = content[:line_end if line_end != -1 else m_end] + body + content[end_m:]
            patched += 1
        if matches:
            try:
                open(sp, "w", encoding="utf-8").write(content)
            except Exception:
                pass
    return {"found": found, "patched": patched}


def _patch_lvl(decompiled_dir):
    """Patch LVL: fòse funk callback ALLOWED nan LicenseChecker."""
    hits = 0
    for sp in _walk_smali_files(decompiled_dir):
        try:
            content = open(sp, encoding="utf-8").read()
        except Exception:
            continue
        if LVL_CHECKER_MARKER not in content and "->allow" not in content:
            continue
        changed = False
        # Chèche objè LicenserCheckerCallback ki resevwa paramèt (allow/disallow)
        # metod ki gen deskriptè (...LicenserCheckerCallback;->allow(...)V) oswa
        # 'allow(I)V' nan klas callback yo. Nou fòse li bay ALLOWED (0x0?).
        # Pou simplicity: ranplase chak apèl 'deny'/'DONT_ALLOW' ak 'ALLOWED'.
        for pat, repl in [
            ("DONT_ALLOW", "ALLOWED"),
            ("NOT_LICENSED", "ALLOWED"),
        ]:
            if pat in content:
                content = content.replace(pat, repl)
                changed = True
                hits += content.count(pat)
        if changed:
            open(sp, "w", encoding="utf-8").write(content)
    return hits


def _patch_ads(decompiled_dir):
    """Dezaktive reklam: retire/neutralize apèl pou montre reklam."""
    hits = 0
    ad_re = re.compile(r"invoke-(?:virtual|static|interface|direct)\s+\{.*?\},\s+(L[^;]*/[^;]*;)->(show|loadAd|displayAd|showInterstitial|loadInterstitial)\(.*\)")
    for sp in _walk_smali_files(decompiled_dir):
        try:
            content = open(sp, encoding="utf-8").read()
        except Exception:
            continue
        if not any(mk in content for mk in ADS_MARKERS):
            continue
        # retire liy 'show' / 'loadAd' yo (met nan kòmantè)
        def repl(mobj):
            return "# " + mobj.group(0)
        content2, n = ad_re.subn(repl, content)
        if n:
            open(sp, "w", encoding="utf-8").write(content2)
            hits += n
    return hits


PATCH_FUNCS = {
    "plan": lambda d: _patch_return(d, RETURN_PATTERNS["plan"]["names"], True),
    "credit": lambda d: _patch_return(d, RETURN_PATTERNS["credit"]["names"], RETURN_PATTERNS["credit"]["value"]),
    "token": lambda d: _patch_return(d, RETURN_PATTERNS["token"]["names"], True),
    "root": lambda d: _patch_return(d, RETURN_PATTERNS["root"]["names"], False),
    "signature": lambda d: _patch_return(d, RETURN_PATTERNS["signature"]["names"], True),
    "lvl": _patch_lvl,
    "ads": _patch_ads,
}


# =============================================================================
# Main
# =============================================================================
def main():
    if len(sys.argv) < 4:
        sys.stdout.write("Itilizasyon: mod_apk.py <apk> <out_dir> <uid> [--patch=...]\n")
        sys.exit(1)

    apk_in = sys.argv[1]
    out_dir = sys.argv[2]
    uid = sys.argv[3]

    # Lis patch mande
    requested_patches = []
    for a in sys.argv[4:]:
        if a.startswith("--patch="):
            p = a[len("--patch="):].strip().lower()
            if p in PATCH_FUNCS:
                requested_patches.append(p)

    if not os.path.exists(apk_in):
        sys.stdout.write("ERR: APK pa jwenn: %s\n" % apk_in)
        sys.exit(2)

    base = os.path.splitext(os.path.basename(apk_in))[0]
    apk_in = os.path.abspath(apk_in)
    out_dir = os.path.abspath(out_dir)
    work = tempfile.mkdtemp(prefix="wamod_")
    os.makedirs(out_dir, exist_ok=True)
    project = os.path.join(work, "app")

    new_name = base[:40] + "★"

    try:
        # 1. Dekonpile
        code, out, err = run_cmd([APKTOOL, "d", "-f", "-o", project, apk_in], timeout=1500)
        if code != 0:
            sys.stdout.write("ERR: Dekonpilasyon echwe: %s\n" % err.strip()[-600:])
            sys.exit(3)
        if not os.path.exists(os.path.join(project, "AndroidManifest.xml")):
            sys.stdout.write("ERR: Pa gen AndroidManifest.xml\n")
            sys.exit(4)

        # 2. Chanje non
        r1 = change_app_name(project, new_name)

        # 3. Enjekte Toast
        r2 = inject_toast(project, "Mod by BaliBuddy ✓")

        # 4. Aplike patch mande yo
        patch_results = {}
        for p in requested_patches:
            try:
                hits = PATCH_FUNCS[p](project)
                patch_results[p] = hits
            except Exception as e:
                patch_results[p] = "err:" + str(e)

        # 5. Rekonstwi
        unsigned = os.path.join(work, base + "_unsigned.apk")
        code, out, err = run_cmd([APKTOOL, "b", project, "-o", unsigned], timeout=1500)
        if code != 0:
            sys.stdout.write("ERR: Rekonstwi echwe: %s\n" % err.strip()[-600:])
            sys.exit(5)

        # 6. zipalign
        aligned = os.path.join(work, base + "_aligned.apk")
        code, _, err = run_cmd([ZIPALIGN, "-f", "4", unsigned, aligned], timeout=600)
        if code != 0:
            sys.stdout.write("ERR: zipalign echwe: %s\n" % err.strip()[-400:])
            sys.exit(6)

        # 7. Siyen
        if not ensure_keystore():
            sys.stdout.write("ERR: Pa ka kreye keystore\n")
            sys.exit(7)
        final = os.path.join(out_dir, base + "_mod.apk")
        code, _, err = run_cmd([APKSIGNER, "sign", "--ks", KEYSTORE_PATH, "--ks-pass", "pass:" + KEYSTORE_PASS,
                                "--ks-key-alias", KEYSTORE_ALIAS, "--out", final, aligned], timeout=600)
        if code != 0:
            sys.stdout.write("ERR: Siyati echwe: %s\n" % err.strip()[-500:])
            sys.exit(8)

        # Rezime patch: liy espesyal ke modbridge.js li pou fè yon rapò klè
        # Fòma: SUMMARY:json
        summary = {
            "plan": patch_results.get("plan", 0),
            "credit": patch_results.get("credit", 0),
            "token": patch_results.get("token", 0),
            "lvl": patch_results.get("lvl", 0),
            "ads": patch_results.get("ads", 0),
            "root": patch_results.get("root", 0),
            "signature": patch_results.get("signature", 0),
        }
        import json as _json
        sys.stdout.write("SUMMARY:%s\n" % _json.dumps(summary))
        sys.stdout.write("OK:%s\n" % final)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
