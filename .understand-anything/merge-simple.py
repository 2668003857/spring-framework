#!/usr/bin/env python3
"""Simple merge script compatible with Python 3.6"""

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path


VALID_NODE_PREFIXES = {
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource"
}

TYPE_TO_PREFIX = {
    "file": "file",
    "function": "function",
    "func": "function",
    "class": "class",
    "module": "module",
    "concept": "concept",
    "config": "config",
    "document": "document",
    "service": "service",
    "table": "table",
    "endpoint": "endpoint",
    "pipeline": "pipeline",
    "schema": "schema",
    "resource": "resource",
}

COMPLEXITY_MAP = {
    "low": "simple",
    "easy": "simple",
    "medium": "moderate",
    "intermediate": "moderate",
    "high": "complex",
    "hard": "complex",
    "difficult": "complex",
}

VALID_COMPLEXITY = {"simple", "moderate", "complex"}


def _num(v):
    """Coerce a value to float for safe comparison"""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_batch(path):
    """Load a batch JSON file, tolerating malformed files."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print("  Warning: skipping %s: %s" % (path.name, e), file=sys.stderr)
        return None

    if not isinstance(data.get("nodes"), list):
        print("  Warning: skipping %s: missing or invalid 'nodes' array" % path.name, file=sys.stderr)
        return None
    if not isinstance(data.get("edges"), list):
        print("  Warning: skipping %s: missing or invalid 'edges' array" % path.name, file=sys.stderr)
        return None

    return data


def normalize_node_id(node_id, node):
    """Normalize a node ID, returning the corrected version."""
    nid = node_id

    # Strip double prefix
    for prefix in VALID_NODE_PREFIXES:
        double = "%s:%s:" % (prefix, prefix)
        if nid.startswith(double):
            nid = nid[len(prefix) + 1:]
            break

    # Strip project-name prefix
    for prefix in VALID_NODE_PREFIXES:
        if nid.startswith(prefix):
            break
    else:
        parts = nid.split(":")
        if len(parts) >= 3 and parts[1] in VALID_NODE_PREFIXES:
            nid = "%s:%s" % (parts[1], parts[2])

    # Canonicalize func prefix
    if nid.startswith("func:") and not nid.startswith("function:"):
        nid = "function:" + nid[5:]

    # Add missing prefix for bare file paths
    has_prefix = any(nid.startswith("%s:" % p) for p in VALID_NODE_PREFIXES)
    if not has_prefix:
        node_type = node.get("type", "file")
        prefix = TYPE_TO_PREFIX.get(node_type, "file")
        if node_type in ("function", "class"):
            file_path = node.get("filePath", "")
            name = node.get("name", nid)
            if file_path:
                nid = "%s:%s:%s" % (prefix, file_path, name)
            else:
                nid = "%s:__nofilepath__:%s" % (prefix, name)
        else:
            nid = "%s:%s" % (prefix, nid)

    return nid


def normalize_complexity(value):
    """Normalize a complexity value"""
    if isinstance(value, str):
        lower = value.strip().lower()
        if lower in VALID_COMPLEXITY:
            return lower
        if lower in COMPLEXITY_MAP:
            return COMPLEXITY_MAP[lower]
        return "moderate"
    elif isinstance(value, (int, float)):
        n = int(value)
        if n <= 3:
            return "simple"
        elif n <= 6:
            return "moderate"
        else:
            return "complex"
    return "moderate"


def merge_and_normalize(batches):
    """Merge batch results and normalize"""
    all_nodes = []
    all_edges = []
    for batch in batches:
        all_nodes.extend(batch.get("nodes", []))
        all_edges.extend(batch.get("edges", []))

    total_input_nodes = len(all_nodes)
    total_input_edges = len(all_edges)

    # Normalize node IDs
    id_mapping = {}
    nodes_with_ids = []

    for i, node in enumerate(all_nodes):
        original_id = node.get("id")
        if not original_id:
            continue
        nodes_with_ids.append(node)
        corrected_id = normalize_node_id(original_id, node)
        if corrected_id != original_id:
            id_mapping[original_id] = corrected_id
            node["id"] = corrected_id

    # Normalize complexity
    for node in nodes_with_ids:
        original = node.get("complexity")
        normalized = normalize_complexity(original)
        node["complexity"] = normalized

    # Rewrite edge references
    for edge in all_edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        new_src = id_mapping.get(src, src)
        new_tgt = id_mapping.get(tgt, tgt)
        if new_src != src or new_tgt != tgt:
            edge["source"] = new_src
            edge["target"] = new_tgt

    # Deduplicate nodes by ID (keep last)
    nodes_by_id = {}
    for node in nodes_with_ids:
        nid = node.get("id", "")
        nodes_by_id[nid] = node

    # Deduplicate edges, drop dangling
    node_ids = set(nodes_by_id.keys())
    edges_by_key = {}
    for edge in all_edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        etype = edge.get("type", "")

        if src not in node_ids or tgt not in node_ids:
            continue

        key = (src, tgt, etype)
        existing = edges_by_key.get(key)
        if existing is None or _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
            edges_by_key[key] = edge

    report = []
    report.append("Input: %d nodes, %d edges" % (total_input_nodes, total_input_edges))
    report.append("Output: %d nodes, %d edges" % (len(nodes_by_id), len(edges_by_key)))

    assembled = {
        "nodes": list(nodes_by_id.values()),
        "edges": list(edges_by_key.values()),
    }

    return assembled, report


def main():
    if len(sys.argv) < 2:
        print("Usage: python merge-simple.py <project-root>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    intermediate_dir = project_root / ".understand-anything" / "intermediate"

    if not intermediate_dir.is_dir():
        print("Error: %s does not exist" % intermediate_dir, file=sys.stderr)
        sys.exit(1)

    # Discover batch files
    batch_files = sorted(
        intermediate_dir.glob("batch-*.json"),
        key=lambda p: int(re.search(r"batch-(\d+)", p.stem).group(1))
        if re.search(r"batch-(\d+)", p.stem)
        else 0,
    )

    if not batch_files:
        print("Error: no batch-*.json files found in intermediate/", file=sys.stderr)
        sys.exit(1)

    print("Found %d batch files:" % len(batch_files), file=sys.stderr)

    batches = []
    for f in batch_files:
        batch = load_batch(f)
        if batch is not None:
            batches.append(batch)
            n = len(batch.get("nodes", []))
            e = len(batch.get("edges", []))
            print("  %s: %d nodes, %d edges" % (f.name, n, e), file=sys.stderr)

    if not batches:
        print("Error: no valid batch files loaded", file=sys.stderr)
        sys.exit(1)

    # Merge and normalize
    assembled, report = merge_and_normalize(batches)

    # Print report
    print("", file=sys.stderr)
    for line in report:
        print(line, file=sys.stderr)

    # Write output
    output_path = intermediate_dir / "assembled-graph.json"
    output_path.write_text(json.dumps(assembled, indent=2, ensure_ascii=False), encoding="utf-8")

    size_kb = output_path.stat().st_size / 1024
    print("\nWritten to %s (%.0f KB)" % (output_path, size_kb), file=sys.stderr)


if __name__ == "__main__":
    main()
