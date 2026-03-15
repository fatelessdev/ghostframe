import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export const Completion = () => {
  const completion = useCompletion();

  return (
    <>
      <Audio {...completion} />
      <Input {...completion} />
      <Screenshot {...completion} />
      <Files {...completion} />
    </>
  );
};
