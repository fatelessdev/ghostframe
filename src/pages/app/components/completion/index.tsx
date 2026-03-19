import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export type CompletionHandle = ReturnType<typeof useCompletion>;

interface CompletionProps {
  completion?: CompletionHandle;
}

export const Completion = ({ completion: externalCompletion }: CompletionProps) => {
  const internalCompletion = useCompletion();
  const completion = externalCompletion ?? internalCompletion;

  return (
    <>
      <Audio {...completion} />
      <Input {...completion} />
      <Screenshot {...completion} />
      <Files {...completion} />
    </>
  );
};
