export interface ExplanationStep {
  lineCode: string;
  explanation: string;
}

export interface TutorialData {
  title: string;
  language: string;
  code: string;
  overview: string;
  steps: ExplanationStep[];
}

export enum LoadingState {
  IDLE = 'IDLE',
  GENERATING_CONTENT = 'GENERATING_CONTENT',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  READY = 'READY',
  ERROR = 'ERROR'
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}
