Acceptance set (worker-visible). Run from the package folder named in each file's first line:

- `core/`: from `tenon/packages/core`, `bun test ../../../implementations/command-centre-hub/acceptance/core`
- `app/`: from `tenon/packages/app`, `bun test --conditions=solid --preload ./happydom.ts ../../../implementations/command-centre-hub/acceptance/app`
