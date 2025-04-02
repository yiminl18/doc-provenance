import provenance
import data_digestion, base_strategies
import os 
import concurrent.futures
current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)

# sufficient_provenance_strategy_pool = ['raw','embedding_sufficient_top_down','embedding_sufficient_bottem_up','divide_and_conquer_sufficient', 'LLM_score_sufficient_top_down', 'LLM_score_sufficient_bottem_up']
sufficient_provenance_strategy_pool = ['LLM_score_sufficient_bottem_up','LLM_score_sufficient_top_down','embedding_sufficient_top_down','embedding_sufficient_bottem_up', 'divide_and_conquer_sufficient']
minimal_provenance_strategy_pool = ['exponential_greedy','sequential_greedy','null'] #'exponential_greedy','sequential_greedy',

import json
def read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

def hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    embedding_folder = parent_directory + '/out/hotpotQA'
    result_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/hotpotQA/results/'
    out_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/hotpotQA/diff_minimal/'
    objects = data_digestion.digest_hotpotQA_dataset(data_path)
    #print(len(hotpot_objects))
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '
    large_case_path = out_folder_path + 'diff_ids.json'
    large_cases = read_json(large_case_path)

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'divide_and_conquer_sufficient':
            #     continue
            if minimal_provenance_strategy == 'null':
                continue

            large_case = large_cases[sufficient_provenance_strategy + '_null']
            print(strategy)

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

                result_path = out_folder_path + str(i) + '_' + str(title) + '_'  + strategy + '.json'
                sufficient_path = result_folder_path + str(i) + '_' + str(title) + '_'  + sufficient_provenance_strategy + '_null' + '.json'

                if not os.path.exists(sufficient_path):
                    continue 

                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, answers, sufficient_status =  get_sufficient_result(sufficient_path)

                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                print('sufficient answers:', answers)

                if answers[0] == 'NULL':
                    continue

                if i not in large_case:
                    continue

                if os.path.isfile(result_path):
                    continue
                
                provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
        #         break
        #     break
        # break



def paper_pipeline():
    data_path = parent_directory + '/data/qasper_sample_papers.json'
    embedding_folder = parent_directory + '/out/papers'
    result_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/paper/results/'
    out_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/paper/diff_minimal/'
    large_case_path = out_folder_path + 'diff_ids.json'
    large_cases = read_json(large_case_path)


    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'embedding_sufficient_top_down':
            #     continue
            if minimal_provenance_strategy == 'null':
                continue

            large_case = large_cases[sufficient_provenance_strategy + '_null']
            print(strategy)

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

                result_path = out_folder_path + str(i) + '_' + str(pid) + '_'  + strategy + '.json'
                sufficient_path = result_folder_path + str(i) + '_' + str(pid) + '_'  + sufficient_provenance_strategy + '_null' + '.json'

                if not os.path.exists(sufficient_path):
                    continue 

                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, sufficient_answers, sufficient_status =  get_sufficient_result(sufficient_path)


                #print('sufficient_answers:', sufficient_answers)

                if i not in large_case:
                    continue


                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                if sufficient_answers[0] == 'NULL':
                    continue

                if os.path.isfile(result_path):
                    continue

                # if(i >= num_case):
                #     break
                
                provenance.logger(text, question, str(pid), result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)

def get_sufficient_result(sufficient_path):
    latency = -1
    in_tokens = -1
    out_tokens = -1
    provenance_ids = [-1]
    eval_time = -1
    answer = ['']
    status = ''
    if os.path.isfile(sufficient_path):
        result = read_json(sufficient_path)
        if 'time' in result and 'tokens' in result and 'provenance_ids' in result and 'eval_time' in result:
            latency = result['time']
            (in_tokens, out_tokens) = result['tokens']
            provenance_ids = result['provenance_ids']
            eval_time = result['eval_time']
        if 'answer' in result:
            answer = result['answer']
        if 'status' in result:
            status = result['status']
    return latency, (in_tokens, out_tokens), provenance_ids, eval_time, answer, status

def write_json_to_file(filename, data):
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)

def nl_dev_pipeline():
    #nl_dev
    data_path = parent_directory + '/data/natural-questions_nq-dev-full.json'
    embedding_folder = parent_directory + '/out/nl_dev'
    #folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/nl_dev/results/'
    result_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/nl_dev/results_minimal/'
    

    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'LLM_score_sufficient_bottem_up':
            #     continue
            if minimal_provenance_strategy == 'null':
                continue
            print(strategy)
            i = 0
            cnt = 0
            for o in objects:
                embedding_path = embedding_folder + '/embeddings/' + 'nl_' + str(i) + '_embeddings.npy'
                
                #print(strategy)
                #print(i+1)

                text = o['text']
                q = o['question']
                question = (q, instruction)
                title = o['id']
                #print(question)
                i += 1

                
                
                result_path = result_folder_path + str(i) + '_' + str(title) + '_'  + strategy + '.json'
                sufficient_path = result_folder_path + str(i) + '_' + str(title) + '_'  + sufficient_provenance_strategy + '_null' + '.json'

                if not os.path.exists(sufficient_path):
                    continue 
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, sufficient_answers, sufficient_status =  get_sufficient_result(sufficient_path)


                # print('result_path:', result_path)
                # print('sufficient_path:', sufficient_path)
                # print('embedding_path:',embedding_path)
                # print('sufficient answers:', sufficient_answers)

                if sufficient_answers[0] == 'NULL':
                    continue

                if sufficient_status == 'long answers':
                    #print('sufficient large:', strategy,i)
                    cnt += 1

                # if os.path.isfile(result_path):
                #     continue
                
                #provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
            print('number of rerun cases:', cnt, strategy)
                
def get_embedding_path(data, embedding_folder, id, object):
    embedding_path = ''
    if data == 'paper':
        return embedding_folder + '/embeddings/' + 'paper_' + str(id) + '_' + object['id'] + '_embeddings.npy'
    if data == 'nl_dev': 
        return embedding_folder + '/embeddings/' + 'nl_' + str(id) + '_embeddings.npy'
    if data == 'hotpotQA':
        return embedding_folder + '/embeddings/' + 'hotpot' + '_q' + str(id) + '_embeddings.npy'
    
def get_result_path(data, result_folder_path, id, object, strategy):
    if data == 'paper':
        return result_folder_path + str(id) + '_' + str(object['id']) + '_'  + strategy + '.json'
    if data == 'nl_dev':
        return result_folder_path + str(id) + '_' + str(object['id']) + '_'  + strategy + '.json'
    if data == 'hotpotQA':
        return result_folder_path + str(id) + '_' + str(object['document_name']) + '_'  + strategy + '.json'

def get_sufficient_path(data, result_folder_path, id, object, sufficient_provenance_strategy): 
    if data == 'paper':
        return result_folder_path + str(id) + '_' + str(object['id']) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
    if data == 'nl_dev':
        return result_folder_path + str(id) + '_' + str(object['id']) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
    if data == 'hotpotQA':
        return result_folder_path + str(id) + '_' + str(object['document_name']) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
    
def pipeline(data, data_path, embedding_folder, result_folder_path):
    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'LLM_score_sufficient_bottem_up':
            #     continue
            if minimal_provenance_strategy == 'null':
                continue
            print(strategy)
            i = 0
            cnt = 0
            for o in objects:
                #print(strategy)
                #print(i+1)

                text = o['text']
                q = o['question']
                question = (q, instruction)
                i += 1

                embedding_path = get_embedding_path(data, embedding_folder, i, o)
                result_path = get_result_path(data, result_folder_path, i, o, strategy)
                sufficient_path = get_sufficient_path(data, result_folder_path, i, o, sufficient_provenance_strategy)

                if not os.path.exists(sufficient_path):
                    continue 
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency, sufficient_answers, sufficient_status =  get_sufficient_result(sufficient_path)


                # print('result_path:', result_path)
                # print('sufficient_path:', sufficient_path)
                # print('embedding_path:',embedding_path)
                # print('sufficient answers:', sufficient_answers)

                if sufficient_answers[0] == 'NULL':
                    continue

                if sufficient_status == 'long answers':
                    #print('sufficient large:', strategy,i)
                    cnt += 1

                # if os.path.isfile(result_path):
                #     continue
                
                #provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
            print('number of rerun cases:', cnt, strategy)

if __name__ == "__main__":
    data = 'paper' 
    data = 'nl_dev'
    data = 'hotpotQA'
    data_folder = ''
    embedding_folder = ''
    result_folder = ''
    if data == 'paper':
        data_folder = parent_directory + '/data/qasper_sample_papers.json'
    elif data == 'nl_dev':
        data_folder = parent_directory + '/data/natural-questions_nq-dev-full.json'
    elif data == 'hotpotQA':
        data_folder = parent_directory + '/data/hotpotQA_fullwiki.json'
    
    embedding_folder = parent_directory + '/out/' + data 
    result_folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/' + data + '/results_minimal/'

    pipeline(data, data_folder, embedding_folder, result_folder)
    