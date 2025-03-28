import provenance
import data_digestion, base_strategies
import os 
import concurrent.futures
current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)

# sufficient_provenance_strategy_pool = ['raw','embedding_sufficient_top_down','embedding_sufficient_bottem_up','divide_and_conquer_sufficient', 'LLM_score_sufficient_top_down', 'LLM_score_sufficient_bottem_up']
sufficient_provenance_strategy_pool = ['LLM_score_sufficient_bottem_up','LLM_score_sufficient_top_down','embedding_sufficient_top_down','embedding_sufficient_bottem_up', 'divide_and_conquer_sufficient']
minimal_provenance_strategy_pool = ['exponential_greedy','sequential_greedy'] #'exponential_greedy','sequential_greedy',

import json
def read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

def hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    embedding_folder = parent_directory + '/out/hotpotQA'
    folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/hotpotQA/results/'
    objects = data_digestion.digest_hotpotQA_dataset(data_path)
    #print(len(hotpot_objects))
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'divide_and_conquer_sufficient':
            #     continue
            # if minimal_provenance_strategy != 'null':
            #     continue

            i = 0
            for o in objects:
                embedding_path = embedding_folder + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
                print(strategy)
                print(i+1)


                text = o['context']
                q = o['question']
                question = (q, instruction)
                title = o['document_name']
                print(question)
                i += 1

                result_path = folder_path + str(i) + '_' + str(title) + '_'  + strategy + '.json'
                sufficient_path = folder_path + str(i) + '_' + str(title) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency =  get_sufficient_result(sufficient_path)

                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                status = 'null'
                if os.path.isfile(result_path):
                    result = read_json(result_path)
                    if 'status' in result:
                        status = result['status']
                    else:
                        status = 'computed'
                
                if status == 'computed':
                    continue
                if(i >= num_case):
                    break
                
                provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)

def paper_pipeline():
    data_path = parent_directory + '/data/qasper_sample_papers.json'
    embedding_folder = parent_directory + '/out/papers'
    folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/paper/results/'

    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'embedding_sufficient_top_down':
            #     continue
            # if minimal_provenance_strategy != 'null':
            #     continue

            i = 0
            for o in objects:
                print(strategy)
                print(i+1)

                text = o['text']
                q = o['question']
                question = (q, instruction)
                pid = o['id']
                embedding_path = embedding_folder + '/embeddings/' + 'paper_' + str(i) + '_' + pid + '_embeddings.npy'
                print(question)
                i += 1

                result_path = folder_path + str(i) + '_' + str(pid) + '_'  + strategy + '.json'
                sufficient_path = folder_path + str(i) + '_' + str(pid) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, sufficient_answers =  get_sufficient_result(sufficient_path)

                print('sufficient_answers:', sufficient_answers)

                # if sufficient_answers[0] == 'NULL':
                #     continue


                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                # if not os.path.exists(sufficient_path):
                #     continue

                if os.path.isfile(result_path):
                    continue

                if(i >= num_case):
                    break
                
                provenance.logger(text, question, str(pid), result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)

def get_sufficient_result(sufficient_path):
    latency = -1
    in_tokens = -1
    out_tokens = -1
    provenance_ids = [-1]
    eval_time = -1
    answer = ['']
    if os.path.isfile(sufficient_path):
        result = read_json(sufficient_path)
        if 'time' in result and 'tokens' in result and 'provenance_ids' in result and 'eval_time' in result:
            latency = result['time']
            (in_tokens, out_tokens) = result['tokens']
            provenance_ids = result['provenance_ids']
            eval_time = result['eval_time']
        if 'answer' in result:
            answer = result['answer']
    return latency, (in_tokens, out_tokens), provenance_ids, eval_time, answer

def write_json_to_file(filename, data):
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)

def nl_dev_pipeline():
    #nl_dev
    data_path = parent_directory + '/data/natural-questions_nq-dev-full.json'
    embedding_folder = parent_directory + '/out/nl_dev'
    folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/nl_dev/results/'

    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'LLM_score_sufficient_bottem_up':
            #     continue
            # if minimal_provenance_strategy != 'null':
            #     continue

            i = 0
            #with concurrent.futures.ProcessPoolExecutor(max_workers=1) as executor:
            for o in objects:
                embedding_path = embedding_folder + '/embeddings/' + 'nl_' + str(i) + '_embeddings.npy'
                
                print(strategy)
                print(i+1)

                text = o['text']
                q = o['question']
                question = (q, instruction)
                title = o['id']
                print(question)
                i += 1

                
                if i == 82 or i == 74 or i == 89 or i == 73 or i == 324:
                    continue

                # if sufficient_provenance_strategy == 'divide_and_conquer_sufficient' and minimal_provenance_strategy == 'sequential_greedy':
                #     if i == 82 or i == 72 or i == 89:
                #         continue
                # if sufficient_provenance_strategy == 'divide_and_conquer_sufficient' and minimal_provenance_strategy == 'exponential_greedy':
                #     if i == 99:
                #         continue
                # if sufficient_provenance_strategy == 'LLM_score_sufficient_bottem_up' and minimal_provenance_strategy == 'sequential_greedy':
                #     if i == 73 or i==324 or i == 74:
                #         continue
                result_path = folder_path + str(i) + '_' + str(title) + '_'  + strategy + '.json'
                sufficient_path = folder_path + str(i) + '_' + str(title) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, sufficient_answers =  get_sufficient_result(sufficient_path)

                print('sufficient_answers:', sufficient_answers)

                if sufficient_answers[0] == 'NULL':
                    continue


                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                #sufficient_time = -1
                #print('sufficient time:', sufficient_time)
                status = 'null'
                if not os.path.exists(sufficient_path):
                    continue

                if os.path.isfile(result_path):
                    continue
                    result = read_json(result_path)
                    if 'status' in result:
                        status = result['status']
                    else:
                        status = 'computed'
                
                # if status == 'computed':
                #     continue
                if(i >= num_case):
                    break
                
                provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
                        

if __name__ == "__main__":
    paper_pipeline()
    