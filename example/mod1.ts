import "jsr:@sigmasd/crash-report/hook";

const panic = () => {
  throw "hello world";
};

if (import.meta.main) {
  console.log(1);
  panic();
  console.log(2);
}
