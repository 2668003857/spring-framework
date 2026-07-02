const fs = require('fs');
const path = require('path');

// Read input file
const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Extract file-level nodes only (type="file")
const fileNodes = data.nodes.filter(n => n.type === 'file');

// Extract import edges (file to file)
const importEdges = data.edges.filter(e =>
  e.type === 'imports' &&
  e.source.startsWith('file:') &&
  e.target.startsWith('file:')
);

// All edges (for cross-category analysis)
const allEdges = data.edges;

// === A. Directory Grouping ===
function getCommonPrefix(filePaths) {
  if (filePaths.length === 0) return '';
  const parts = filePaths[0].split(/[\\/]/);
  let prefix = '';
  for (let i = 0; i < parts.length; i++) {
    const candidate = prefix + parts[i] + '/';
    if (filePaths.every(p => p.replace(/\\/g, '/').startsWith(candidate))) {
      prefix = candidate;
    } else {
      break;
    }
  }
  return prefix;
}

function getTopLevelGroup(filePath, commonPrefix) {
  const normalized = filePath.replace(/\\/g, '/');
  const relative = normalized.startsWith(commonPrefix)
    ? normalized.slice(commonPrefix.length)
    : normalized;

  const parts = relative.split('/');
  if (parts.length > 1) {
    // Check for Spring module pattern: spring-xxx
    if (parts[0].match(/^spring-/)) {
      return parts[0];
    }
    // Other module directories
    return parts[0];
  }
  return 'root';
}

const filePaths = fileNodes.map(n => n.filePath);
const commonPrefix = getCommonPrefix(filePaths);

const directoryGroups = {};
fileNodes.forEach(node => {
  const group = getTopLevelGroup(node.filePath, commonPrefix);
  if (!directoryGroups[group]) {
    directoryGroups[group] = [];
  }
  directoryGroups[group].push(node.id);
});

// === B. Node Type Grouping ===
const nodeTypeGroups = {};
fileNodes.forEach(node => {
  const type = node.type;
  if (!nodeTypeGroups[type]) {
    nodeTypeGroups[type] = [];
  }
  nodeTypeGroups[type].push(node.id);
});

// === C. Import Adjacency Matrix ===
const adjacency = {};
const fanIn = {};
const fanOut = {};

fileNodes.forEach(n => {
  adjacency[n.id] = [];
  fanIn[n.id] = 0;
  fanOut[n.id] = 0;
});

importEdges.forEach(edge => {
  adjacency[edge.source].push(edge.target);
  fanOut[edge.source]++;
  fanIn[edge.target]++;
});

// === D. Cross-Category Dependency Analysis ===
const crossCategoryEdges = {};
allEdges.forEach(edge => {
  // Extract node types from IDs
  const sourceType = edge.source.split(':')[0];
  const targetType = edge.target.split(':')[0];
  const key = `${sourceType}->${targetType}:${edge.type}`;
  crossCategoryEdges[key] = (crossCategoryEdges[key] || 0) + 1;
});

const crossCategoryList = Object.entries(crossCategoryEdges).map(([key, count]) => {
  const [types, edgeType] = key.split(':');
  const [fromType, toType] = types.split('->');
  return { fromType, toType, edgeType, count };
});

// === E. Inter-Group Import Frequency ===
const interGroupImports = {};

// Build group lookup
const fileToGroup = {};
Object.entries(directoryGroups).forEach(([group, files]) => {
  files.forEach(f => fileToGroup[f] = group);
});

importEdges.forEach(edge => {
  const fromGroup = fileToGroup[edge.source];
  const toGroup = fileToGroup[edge.target];
  if (fromGroup && toGroup && fromGroup !== toGroup) {
    const key = `${fromGroup}->${toGroup}`;
    interGroupImports[key] = (interGroupImports[key] || 0) + 1;
  }
});

const interGroupList = Object.entries(interGroupImports).map(([key, count]) => {
  const [from, to] = key.split('->');
  return { from, to, count };
});

// === F. Intra-Group Import Density ===
const intraGroupDensity = {};
Object.entries(directoryGroups).forEach(([group, files]) => {
  const fileSet = new Set(files);
  let internalEdges = 0;
  let totalEdges = 0;

  files.forEach(f => {
    adjacency[f].forEach(target => {
      totalEdges++;
      if (fileSet.has(target)) {
        internalEdges++;
      }
    });
  });

  intraGroupDensity[group] = {
    internalEdges,
    totalEdges,
    density: totalEdges > 0 ? internalEdges / totalEdges : 0
  };
});

// === G. Directory Pattern Matching ===
function matchPattern(dirName, filePath = '') {
  // Spring module patterns
  if (dirName === 'spring-core') return 'core';
  if (dirName === 'spring-beans') return 'core';
  if (dirName === 'spring-context') return 'context';
  if (dirName === 'spring-aop') return 'aop';
  if (dirName === 'spring-aspects') return 'aop';
  if (dirName === 'spring-web') return 'web';
  if (dirName === 'spring-webmvc') return 'web';
  if (dirName === 'spring-webflux') return 'webflux';
  if (dirName === 'spring-jdbc') return 'data-access';
  if (dirName === 'spring-orm') return 'data-access';
  if (dirName === 'spring-tx') return 'data-access';
  if (dirName === 'spring-messaging') return 'messaging';
  if (dirName === 'spring-test') return 'testing';
  if (dirName === 'spring-instrument') return 'instrumentation';
  if (dirName === 'spring-jcl') return 'core';
  if (dirName === 'spring-expression') return 'core';

  // Integration tests
  if (dirName === 'integration-tests') return 'integration-test';

  // Documentation
  if (dirName === 'framework-docs') return 'documentation';
  if (dirName === 'src') {
    if (filePath.includes('/asciidoc/') || filePath.includes('/api/')) return 'documentation';
  }

  return 'unknown';
}

const patternMatches = {};
Object.keys(directoryGroups).forEach(dir => {
  patternMatches[dir] = matchPattern(dir, directoryGroups[dir][0] || '');
});

// === H. Deployment Topology Detection ===
const deploymentTopology = {
  hasDockerfile: false,
  hasCompose: false,
  hasK8s: false,
  hasTerraform: false,
  hasCI: false,
  infraFiles: []
};

fileNodes.forEach(node => {
  const name = node.name.toLowerCase();
  if (name === 'dockerfile') {
    deploymentTopology.hasDockerfile = true;
    deploymentTopology.infraFiles.push(node.filePath);
  }
  if (name.startsWith('docker-compose')) {
    deploymentTopology.hasCompose = true;
    deploymentTopology.infraFiles.push(node.filePath);
  }
  if (name.endsWith('.tf') || name.endsWith('.tfvars')) {
    deploymentTopology.hasTerraform = true;
    deploymentTopology.infraFiles.push(node.filePath);
  }
});

// Check for CI files
const hasCI = fileNodes.some(n =>
  n.filePath.includes('.github') ||
  n.name.includes('jenkins') ||
  n.name.includes('gitlab-ci')
);
deploymentTopology.hasCI = hasCI;

// === I. Data Pipeline Detection ===
const dataPipeline = {
  schemaFiles: fileNodes.filter(n =>
    n.name.endsWith('.sql') ||
    n.name.endsWith('.xsd') ||
    n.name.endsWith('.dtd')
  ).map(n => n.filePath),
  migrationFiles: fileNodes.filter(n =>
    n.filePath.toLowerCase().includes('migration') && n.name.endsWith('.sql')
  ).map(n => n.filePath),
  dataModelFiles: [],
  apiHandlerFiles: []
};

// === J. Documentation Coverage ===
const docGroups = Object.entries(directoryGroups)
  .filter(([group]) => patternMatches[group] === 'documentation')
  .map(([group]) => group);

const totalGroups = Object.keys(directoryGroups).length;
const undocumentedGroups = Object.keys(directoryGroups).filter(g =>
  patternMatches[g] !== 'documentation' &&
  !docGroups.includes(g)
);

const docCoverage = {
  groupsWithDocs: docGroups.length,
  totalGroups,
  coverageRatio: docGroups.length / totalGroups,
  undocumentedGroups
};

// === K. Dependency Direction ===
const groupDeps = {};
Object.keys(directoryGroups).forEach(g => {
  groupDeps[g] = {};
});

interGroupList.forEach(({ from, to }) => {
  groupDeps[from][to] = (groupDeps[from][to] || 0) + 1;
});

const dependencyDirection = [];
Object.keys(groupDeps).forEach(dependent => {
  Object.keys(groupDeps[dependent]).forEach(dependsOn => {
    const forward = groupDeps[dependent][dependsOn] || 0;
    const reverse = groupDeps[dependsOn]?.[dependent] || 0;
    if (forward > reverse) {
      dependencyDirection.push({ dependent, dependsOn, ratio: forward / Math.max(1, reverse) });
    }
  });
});

// === File Stats ===
const filesPerGroup = {};
Object.entries(directoryGroups).forEach(([group, files]) => {
  filesPerGroup[group] = files.length;
});

const nodeTypeCounts = {};
Object.entries(nodeTypeGroups).forEach(([type, files]) => {
  nodeTypeCounts[type] = files.length;
});

// Sort fan in/out for top files
const sortedFanIn = Object.entries(fanIn)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

const sortedFanOut = Object.entries(fanOut)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

// === Output ===
const results = {
  scriptCompleted: true,
  directoryGroups,
  nodeTypeGroups,
  crossCategoryEdges: crossCategoryList,
  interGroupImports: interGroupList,
  intraGroupDensity,
  patternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection,
  fileStats: {
    totalFileNodes: fileNodes.length,
    filesPerGroup,
    nodeTypeCounts
  },
  fileFanIn: sortedFanIn,
  fileFanOut: sortedFanOut
};

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`Analysis complete. Processed ${fileNodes.length} file nodes.`);
console.log(`Directory groups: ${Object.keys(directoryGroups).length}`);
