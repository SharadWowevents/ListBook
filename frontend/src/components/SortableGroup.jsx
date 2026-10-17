import React, { useEffect, useRef } from "react";
import Sortable from "sortablejs";

export default function SortableGroup({ groupName, onReorder, children }) {
  const containerRef = useRef(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (!containerRef.current) return;
    const sortable = Sortable.create(containerRef.current, {
      animation: 160,
      delay: 180,
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      filter: ".todo-edit",
      preventOnFilter: false,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      onEnd() {
        const ids = [...containerRef.current.children]
          .map((c) => c.dataset.id)
          .filter(Boolean);
        onReorderRef.current(ids);
      },
    });

    return () => sortable.destroy();
  }, []);

  return (
    <div className="group" data-group={groupName} ref={containerRef}>
      {children}
    </div>
  );
}