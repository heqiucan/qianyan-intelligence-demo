"""Exercise the configured MCP process and all eight tools without an LLM call."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "motion-site-builder"
ENGINE = VENDOR / "skills" / "motion-site-builder" / "scripts"
EXPECTED_TOOLS = {
    "motion_list_profiles", "motion_get_tokens", "motion_get_template",
    "motion_find_reference", "motion_suggest_pattern", "motion_easing_rationale",
    "motion_validate", "motion_validate_file",
}


def run_json(command, cwd, env, input_text=None):
    result = subprocess.run(
        command, cwd=cwd, env=env, input=input_text, capture_output=True,
        text=True, encoding="utf-8", timeout=30,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError(f"Process exited {result.returncode}: {result.stderr}")
    if result.stderr.strip():
        raise RuntimeError(f"Unexpected server stderr: {result.stderr}")
    return result.stdout


def tool_value(response):
    result = response["result"]
    assert not result.get("isError"), result
    text = result["content"][0]["text"]
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(value, dict):
        assert "error" not in value, value
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / ".codex" / "config.toml")
    args = parser.parse_args()
    config_path = args.config.resolve()
    config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    server = config["mcp_servers"]["motion-site-tools"]
    assert server.get("enabled", True), "MCP is disabled"
    env = {**os.environ, **server.get("env", {}), "PYTHONDONTWRITEBYTECODE": "1"}
    python = [server["command"], "-B", "-X", "utf8"]
    command = [server["command"], *server.get("args", [])]
    cwd = Path(server["cwd"])
    assert Path(server["command"]).is_file(), "Configured Python is missing"
    assert cwd == VENDOR, "Configured working directory does not match this project"
    assert Path(server["args"][-1]) == ENGINE / "server.py", "Unexpected server entry"

    self_tests = {}
    for script in ("lint_motion.py", "audit_consistency.py"):
        data = json.loads(run_json(python + [str(ENGINE / script), "--self-test"], cwd, env))
        assert data["pass"], data
        self_tests[script] = "passed"

    output_dir = ROOT / "tmp" / "motion-mcp-check"
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="smoke-", dir=output_dir) as scratch:
        scratch = Path(scratch)
        fresh_path = scratch / "prompt-index.json"
        run_json(python + [str(ENGINE / "build_index.py"), str(VENDOR / "prompts"), str(fresh_path)], cwd, env)
        fresh = json.loads(fresh_path.read_text(encoding="utf-8"))
        committed = json.loads((ENGINE.parent / "data" / "prompt-index.json").read_text(encoding="utf-8"))
        assert fresh == committed, "Vendored prompt index is stale"
        assert fresh["meta"]["count"] == 54

        bad_code = '<button style="transition: all 0.3s ease-in">确认投放</button>'
        fixture = scratch / "中文路径-按钮.html"
        fixture.write_text(bad_code, encoding="utf-8")
        calls = [
            ("motion_list_profiles", {}),
            ("motion_get_tokens", {"profile": "product-ui"}),
            ("motion_get_template", {"name": "product-ui-stat-card"}),
            ("motion_find_reference", {"query": "product-ui dashboard", "limit": 3}),
            ("motion_suggest_pattern", {"intent": "list_stagger", "profile": "product-ui"}),
            ("motion_easing_rationale", {"intent": "popover", "profile": "product-ui"}),
            ("motion_validate", {"code": bad_code, "file_name": "中文按钮.html", "profile": "product-ui"}),
            ("motion_validate_file", {"file_path": str(fixture), "profile": "product-ui"}),
        ]
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2024-11-05", "capabilities": {},
                "clientInfo": {"name": "project-motion-smoke", "version": "1.0.0"},
            }},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        ]
        for request_id, (name, arguments) in enumerate(calls, start=3):
            messages.append({"jsonrpc": "2.0", "id": request_id, "method": "tools/call",
                             "params": {"name": name, "arguments": arguments}})
        wire = "\n".join(json.dumps(message, ensure_ascii=False) for message in messages) + "\n"
        output = run_json(command, cwd, env, wire)
        responses = [json.loads(line) for line in output.splitlines() if line.strip()]
        assert len(responses) == 10, "Missing or unexpected MCP responses"
        by_id = {message["id"]: message for message in responses}
        assert set(by_id) == set(range(1, 11))
        assert all("error" not in response for response in responses), responses
        initialized = by_id[1]["result"]
        assert initialized["serverInfo"]["name"] == "motion-site-tools"
        advertised = {tool["name"] for tool in by_id[2]["result"]["tools"]}
        assert advertised == EXPECTED_TOOLS, advertised
        values = {name: tool_value(by_id[i]) for i, (name, _) in enumerate(calls, start=3)}
        profiles = values["motion_list_profiles"]["profiles"]
        assert {"cinematic", "product-ui", "editorial", "playful", "ecommerce"} == set(profiles)
        assert {"easings", "durations", "palette"} <= set(values["motion_get_tokens"])
        assert isinstance(values["motion_get_template"], str) and len(values["motion_get_template"]) > 100
        references = values["motion_find_reference"]["hits"]
        assert references, "Reference retrieval returned no matches"
        for hit in references:
            assert (VENDOR / "prompts" / hit["file"]).is_file(), hit
        assert values["motion_suggest_pattern"]["intent"] == "list_stagger"
        assert values["motion_easing_rationale"]["intent"] == "popover"
        for name in ("motion_validate", "motion_validate_file"):
            report = values[name]
            assert report["score"] < 100, report
            assert "M10" in {finding["rule_id"] for finding in report["findings"]}, report
        assert values["motion_validate"]["score"] == values["motion_validate_file"]["score"]

    report = {
        "status": "passed", "config": str(config_path), "server": initialized["serverInfo"],
        "upstream_self_tests": self_tests, "index_count": fresh["meta"]["count"],
        "index_matches_upstream": True, "tools_exercised": sorted(advertised),
        "profiles": profiles, "reference_hits": [hit["file"] for hit in references],
        "utf8_request_and_chinese_file_path": "passed",
        "invalid_motion_detected": "M10 transition: all",
        "note": "This checks the configured stdio process; desktop-session discovery is a separate check.",
    }
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    (output_dir / "verification.json").write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
