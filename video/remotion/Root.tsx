import React from 'react';
import { Composition } from 'remotion';
import { timeline } from './lib/timeline';
import { SubmissionVideo } from './Video';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="submission"
    component={SubmissionVideo}
    durationInFrames={timeline.durationInFrames}
    fps={timeline.fps}
    width={timeline.width}
    height={timeline.height}
  />
);
