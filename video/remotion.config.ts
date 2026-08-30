import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setChromiumOpenGlRenderer('angle');
Config.overrideWebpackConfig((config) => ({
  ...config,
  // timeline.json inlines the terminal recordings, so the JSON loader has to
  // take a file well past webpack's default comfort.
  performance: { ...config.performance, hints: false },
}));
