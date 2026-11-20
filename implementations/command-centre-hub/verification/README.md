Verification set (separate cases from the same criteria). Run from the package folder named in each file's first line:

- `core/`: from `tenon/packages/core`, `bun test ../../../implementations/command-centre-hub/verification/core`
- `app/`: from `tenon/packages/app`, `bun test --conditions=solid --preload ./happydom.ts ../../../implementations/command-centre-hub/verification/app`
