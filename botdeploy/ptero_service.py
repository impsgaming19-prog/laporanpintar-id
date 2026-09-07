"""Pterodactyl Panel Application API client — async wrapper.

Env yang dibaca (dari /app/backend/.env):
  PTERO_PANEL_URL         (contoh: http://103.253.244.26)
  PTERO_APP_API_KEY       (ptla_...)
  PTERO_NEST_ID           (default: 1)
  PTERO_EGG_ID            (default: 1)
  PTERO_LOCATION_ID       (default: 1)
"""
import asyncio
import os
import secrets
import string
import logging
import requests

log = logging.getLogger("ptero")


def _env(key, default=""):
    """Baca env LIVE tiap dipanggil (bukan cache di module load)."""
    return (os.environ.get(key, default) or default).strip()


def _panel_url():
    return _env("PTERO_PANEL_URL").rstrip("/")


def _api_key():
    return _env("PTERO_APP_API_KEY")


def _nest_id():
    try: return int(_env("PTERO_NEST_ID", "5") or 5)
    except Exception: return 5


def nest_id():
    """Nest id yang dipakai (default: 5 = BOT HOSTING)."""
    return _nest_id()


def python_egg_id():
    """Egg id untuk tipe Python (default: 17)."""
    try: return int(_env("PTERO_PY_EGG_ID", "17") or 17)
    except Exception: return 17


def node_egg_id():
    """Egg id untuk tipe Node.js (default: 18)."""
    try: return int(_env("PTERO_NODE_EGG_ID", "18") or 18)
    except Exception: return 18


def _egg_id():
    try: return int(_env("PTERO_EGG_ID", "17") or 17)
    except Exception: return 17


def _location_id():
    try: return int(_env("PTERO_LOCATION_ID", "1") or 1)
    except Exception: return 1


def _headers():
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def enabled():
    return bool(_panel_url() and _api_key())


# Backward-compat (kalau ada modul lain baca ptero_service.PANEL_URL)
class _LazyStr:
    def __init__(self, getter): self._g = getter
    def __str__(self): return self._g()
    def __bool__(self): return bool(self._g())
    def __repr__(self): return repr(self._g())
    def rstrip(self, *a, **k): return self._g().rstrip(*a, **k)


PANEL_URL = _LazyStr(_panel_url)
API_KEY = _LazyStr(_api_key)


def _run(fn):
    return asyncio.get_event_loop().run_in_executor(None, fn)


def _gen_password(n=14):
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(n))


async def get_egg_details(nest_id=None, egg_id=None):
    nid = nest_id or _nest_id()
    eid = egg_id or _egg_id()
    url = f"{_panel_url()}/api/application/nests/{nid}/eggs/{eid}?include=variables"
    r = await _run(lambda: requests.get(url, headers=_headers(), timeout=15))
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}: {r.text[:200]}"
    return r.json().get("attributes", {}), None


async def find_or_create_user(email, first_name, last_name, username, password=None):
    """Cari user by email; kalau belum ada, buat dengan password (random kalau kosong).
    Return: (attributes, password_baru, error) — password_baru None kalau user sudah ada."""
    url = f"{_panel_url()}/api/application/users?filter[email]={email}"
    r = await _run(lambda: requests.get(url, headers=_headers(), timeout=15))
    if r.status_code == 200:
        data = r.json().get("data", [])
        if data:
            return data[0]["attributes"], None, None
    password = password or _gen_password()
    body = {
        "email": email, "username": username,
        "first_name": first_name or "User", "last_name": last_name or "Panel",
        "password": password, "language": "en",
    }
    r = await _run(lambda: requests.post(f"{_panel_url()}/api/application/users",
                                          json=body, headers=_headers(), timeout=20))
    if r.status_code != 201:
        return None, None, f"Create user HTTP {r.status_code}: {r.text[:250]}"
    return r.json().get("attributes", {}), password, None


async def reset_user_password(user_id, new_password, email="", username="",                             first_name="User", last_name="Kako"):
    """Reset password user Pterodactyl (dipakai saat user panel sudah pernah dibuat).
    Application API butuh email/username wajib — kirim full payload + password baru."""
    url = f"{_panel_url()}/api/application/users/{user_id}"
    body = {
        "email": email,
        "username": username,
        "first_name": first_name or "User",
        "last_name": last_name or "Kako",
        "language": "en",
        "password": new_password,
    }
    r = await _run(lambda: requests.patch(url, json=body, headers=_headers(), timeout=20))
    if r.status_code not in (200, 204):
        return None, f"HTTP {r.status_code}: {r.text[:250]}"
    return r.json().get("attributes", {}), None


async def get_free_allocation(location_id=None):
    lid = location_id or _location_id()
    r = await _run(lambda: requests.get(f"{_panel_url()}/api/application/nodes",
                                         headers=_headers(), timeout=15))
    if r.status_code != 200:
        return None, None, f"nodes HTTP {r.status_code}"
    nodes = [n["attributes"] for n in r.json().get("data", [])
             if n["attributes"].get("location_id") == lid]
    if not nodes:
        return None, None, "No node in location"
    node = nodes[0]
    r = await _run(lambda: requests.get(
        f"{_panel_url()}/api/application/nodes/{node['id']}/allocations?per_page=200",
        headers=_headers(), timeout=15))
    if r.status_code != 200:
        return None, None, f"allocations HTTP {r.status_code}"
    for a in r.json().get("data", []):
        attr = a["attributes"]
        if not attr.get("assigned"):
            return attr["id"], node["id"], None
    return None, None, "No free allocation"


async def create_server(pterodactyl_user_id, name, memory_mb, disk_mb, cpu_percent=100,
                        nest_id=None, egg_id=None):
    nid = nest_id or _nest_id()
    eid = egg_id or _egg_id()
    egg, err = await get_egg_details(nid, eid)
    if err:
        return None, f"get egg: {err}"
    env_vars = {}
    variables = egg.get("relationships", {}).get("variables", {}).get("data", [])
    for v in variables:
        a = v.get("attributes", {})
        if a.get("env_variable"):
            env_vars[a["env_variable"]] = a.get("default_value") or ""
    alloc_id, node_id, err = await get_free_allocation()
    if err:
        return None, f"allocation: {err}"
    body = {
        "name": name[:60], "user": pterodactyl_user_id, "egg": eid,
        "docker_image": egg.get("docker_image") or list(egg.get("docker_images", {}).values() or [""])[0],
        "startup": egg.get("startup", ""),
        "environment": env_vars,
        "limits": {"memory": memory_mb, "swap": 0, "disk": disk_mb, "io": 500, "cpu": cpu_percent},
        "feature_limits": {"databases": 1, "allocations": 1, "backups": 1},
        "allocation": {"default": alloc_id},
    }
    r = await _run(lambda: requests.post(f"{_panel_url()}/api/application/servers",
                                          json=body, headers=_headers(), timeout=30))
    if r.status_code != 201:
        return None, f"create server HTTP {r.status_code}: {r.text[:300]}"
    return r.json().get("attributes", {}), None


async def list_servers_by_user_id(pterodactyl_user_id):
    url = f"{_panel_url()}/api/application/servers?filter[user]={pterodactyl_user_id}"
    r = await _run(lambda: requests.get(url, headers=_headers(), timeout=15))
    if r.status_code != 200:
        return [], f"HTTP {r.status_code}"
    return [s["attributes"] for s in r.json().get("data", [])], None


async def get_server(server_id):
    """Ambil detail server by id; None + error kalau tidak ada (404 = phantom)."""
    url = f"{_panel_url()}/api/application/servers/{server_id}"
    r = await _run(lambda: requests.get(url, headers=_headers(), timeout=15))
    if r.status_code == 200:
        return r.json().get("attributes", {}), None
    return None, f"HTTP {r.status_code}: {r.text[:200]}"

async def suspend_server(server_id):
    url = f"{_panel_url()}/api/application/servers/{server_id}/suspend"
    r = await _run(lambda: requests.post(url, headers=_headers(), timeout=20))
    return r.status_code in (204, 200), (None if r.status_code in (204, 200) else f"HTTP {r.status_code}: {r.text[:200]}")


async def unsuspend_server(server_id):
    url = f"{_panel_url()}/api/application/servers/{server_id}/unsuspend"
    r = await _run(lambda: requests.post(url, headers=_headers(), timeout=20))
    return r.status_code in (204, 200), (None if r.status_code in (204, 200) else f"HTTP {r.status_code}: {r.text[:200]}")


async def delete_server(server_id):
    url = f"{_panel_url()}/api/application/servers/{server_id}"
    r = await _run(lambda: requests.delete(url, headers=_headers(), timeout=20))
    return r.status_code in (204, 200), (None if r.status_code in (204, 200) else f"HTTP {r.status_code}: {r.text[:200]}")
