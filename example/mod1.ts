import "jsr:@sigmasd/crash-report";

const panic = () => {
  throw "hello world";
};

if (import.meta.main) {
  console.log(1);
  panic();
  console.log(2);
}
