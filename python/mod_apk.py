# -*- coding: utf-8 -*-
"""
mod_apk.py — Script Python endepandan pou modifikasyon APK (bot WhatsApp).

Reutilize lojik apk-mod-bot la. Li fè:
  1. dekonpile (apktool d)
  2. chanje non app (android:label)
  3. enjekte Toast nan onCreate() launcher
  4. rekonstwi (apktool b)
  5. zipalign
  6. apksigner (siyen)

Itilizasyon:
  python3 mod_apk.py <apk_entree> <out_dir> <uid>

Lè siksè li ekri sou dènye liy: OK:<chemen_apk_final>
(Kòmantè an Kreyòl Ayisyen)
"""
import os
import re
import sys
import shutil
import subprocess
import tempfile

MEMORY_FILE = "/root/.bali_mod_name"


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


def find_launcher_class(decompiled_dir):
    manifest = os.path.join(decompiled_dir, "AndroidManifest.xml")
    if not os.path.exists(manifest):
        return None
    content = open(manifest, encoding="utf-8").read()
    # Kaptire <activity ...> ouvèti a AK nimewo android:name li,
    # epi kò a (ki gen intent-filter MAIN/LAUNCHER) separeman.
    blocks = re.findall(r"(<activity\b[^>]*>)(.*?)</activity>", content, re.DOTALL)
    for open_tag, body in blocks:
        if "android.intent.action.MAIN" in body and "android.intent.category.LAUNCHER" in body:
            m = re.search(r'android:name="([^"]+)"', open_tag)
            if m: return m.group(1)
    # Fallback: alias aktivite
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
# Operasyon
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
    # asire .locals >= 2
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
    """Kreye keystore si li pa egziste."""
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


def main():
    if len(sys.argv) < 4:
        sys.stdout.write("Itilizasyon: mod_apk.py <apk> <out_dir> <uid>\n")
        sys.exit(1)

    apk_in = sys.argv[1]
    out_dir = sys.argv[2]
    uid = sys.argv[3]

    if not os.path.exists(apk_in):
        sys.stdout.write("ERR: APK pa jwenn: %s\n" % apk_in)
        sys.exit(2)

    base = os.path.splitext(os.path.basename(apk_in))[0]
    apk_in = os.path.abspath(apk_in)
    out_dir = os.path.abspath(out_dir)
    work = tempfile.mkdtemp(prefix="wamod_")
    os.makedirs(out_dir, exist_ok=True)
    project = os.path.join(work, "app")

    # Kesyon non aplikasyon an: nou pa mande itilizatè, nou sèvi ak yon
    # etap senp: ajoute yon suffixe "★" pou make l kòm mod (ou ka chanje li).
    # (Nan vèsyon konplè, bot la mande nouvo non an nan chat.)
    new_name = base[:40] + "★"

    try:
        # 1. Dekonpile
        code, out, err = run_cmd([APKTOOL, "d", "-f", "-o", project, apk_in], timeout=1200)
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

        # 4. Rekonstwi
        unsigned = os.path.join(work, base + "_unsigned.apk")
        code, out, err = run_cmd([APKTOOL, "b", project, "-o", unsigned], timeout=1200)
        if code != 0:
            sys.stdout.write("ERR: Rekonstwi echwe: %s\n" % err.strip()[-600:])
            sys.exit(5)

        # 5. zipalign
        aligned = os.path.join(work, base + "_aligned.apk")
        code, _, err = run_cmd([ZIPALIGN, "-f", "4", unsigned, aligned], timeout=600)
        if code != 0:
            sys.stdout.write("ERR: zipalign echwe: %s\n" % err.strip()[-400:])
            sys.exit(6)

        # 6. Siyen
        if not ensure_keystore():
            sys.stdout.write("ERR: Pa ka kreye keystore\n")
            sys.exit(7)
        final = os.path.join(out_dir, base + "_mod.apk")
        code, _, err = run_cmd([APKSIGNER, "sign", "--ks", KEYSTORE_PATH, "--ks-pass", "pass:" + KEYSTORE_PASS,
                                "--ks-key-alias", KEYSTORE_ALIAS, "--out", final, aligned], timeout=600)
        if code != 0:
            sys.stdout.write("ERR: Siyati echwe: %s\n" % err.strip()[-500:])
            sys.exit(8)

        sys.stdout.write("OK:%s\n" % final)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
