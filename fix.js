import fs from 'fs';
const text = fs.readFileSync('src/pages/app/index.tsx', 'utf8');
const fixed = text.replace(/onStartInterview=\{\(\) => \{\s+void handleStartInterview\(\);\s+\}\}\s+\/\>/, "onStartInterview={() => {\n                  void handleStartInterview();\n                }}\n                onOpenSettings={() => { void openSettingsPanel(); }}\n              />");
fs.writeFileSync('src/pages/app/index.tsx', fixed);
